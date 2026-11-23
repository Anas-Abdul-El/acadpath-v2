import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma, UserRole } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  PublicUser,
  SessionRecord,
  UserWithPassword,
} from './auth.types.js';

const publicUserSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
} as const satisfies Prisma.UserSelect;

const sessionSelect = {
  id: true,
  userId: true,
  refreshTokenHash: true,
  expiresAt: true,
} as const satisfies Prisma.SessionSelect;

/**
 * Every database query the auth feature makes (v1: repositories/auth.repo.ts). Keeping
 * Prisma out of AuthService means the service holds only the rules, and tests can swap
 * this class for a fake.
 */
@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  findUserByEmail(email: string): Promise<UserWithPassword | null> {
    return this.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: { ...publicUserSelect, passwordHash: true },
    });
  }

  findUserById(id: string): Promise<PublicUser | null> {
    return this.prisma.user.findUnique({
      where: { id },
      select: publicUserSelect,
    });
  }

  /** Every account created here is a student. Admins are promoted by a script. */
  async createUser(data: {
    email: string;
    name: string;
    passwordHash: string;
  }): Promise<PublicUser> {
    try {
      return await this.prisma.user.create({
        data: { ...data, role: UserRole.STUDENT },
        select: publicUserSelect,
      });
    } catch (error) {
      // Two sign-ups with the same email can both pass the "already registered" check;
      // the unique index stops the second one. Report it as the same 409.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Email is already registered');
      }
      throw error;
    }
  }

  async createSession(
    id: string,
    userId: string,
    refreshTokenHash: string,
    expiresAt: Date,
  ): Promise<void> {
    await this.prisma.session.create({
      data: { id, userId, refreshTokenHash, expiresAt },
    });
  }

  findSessionById(id: string): Promise<SessionRecord | null> {
    return this.prisma.session.findUnique({
      where: { id },
      select: sessionSelect,
    });
  }

  async deleteSession(id: string): Promise<void> {
    // deleteMany doesn't throw when the session is already gone (e.g. a double logout).
    await this.prisma.session.deleteMany({ where: { id } });
  }

  /**
   * Swaps the hash only if it is still the one the caller checked, so two refreshes
   * racing with the same token can't both succeed. Returns false when the other won.
   */
  async rotateRefreshToken(
    id: string,
    oldRefreshTokenHash: string,
    newRefreshTokenHash: string,
    expiresAt: Date,
  ): Promise<boolean> {
    const { count } = await this.prisma.session.updateMany({
      where: { id, refreshTokenHash: oldRefreshTokenHash },
      data: {
        refreshTokenHash: newRefreshTokenHash,
        lastUsedAt: new Date(),
        expiresAt,
      },
    });
    return count === 1;
  }
}
