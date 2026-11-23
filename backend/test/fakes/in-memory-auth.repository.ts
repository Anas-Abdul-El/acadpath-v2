import { randomUUID } from 'node:crypto';
import type { AuthRepository } from '../../src/auth/auth.repository.js';
import type {
  PublicUser,
  SessionRecord,
  UserWithPassword,
} from '../../src/auth/auth.types.js';
import { UserRole } from '../../src/generated/prisma/enums.js';

/**
 * Stands in for AuthRepository in e2e tests, so the whole HTTP pipeline (pipes, guards,
 * filters, controller, service) runs without a database. It mirrors the Prisma queries:
 * case-insensitive email lookup, compare-and-swap token rotation, idempotent delete.
 */
export class InMemoryAuthRepository implements Pick<
  AuthRepository,
  keyof AuthRepository
> {
  readonly users = new Map<string, UserWithPassword>();
  readonly sessions = new Map<string, SessionRecord>();

  findUserByEmail(email: string): Promise<UserWithPassword | null> {
    const user = [...this.users.values()].find(
      (u) => u.email.toLowerCase() === email.toLowerCase(),
    );
    return Promise.resolve(user ? { ...user } : null);
  }

  findUserById(id: string): Promise<PublicUser | null> {
    const user = this.users.get(id);
    if (!user) return Promise.resolve(null);
    const { passwordHash: _, ...publicUser } = user;
    return Promise.resolve(publicUser);
  }

  createUser(data: {
    email: string;
    name: string;
    passwordHash: string;
  }): Promise<PublicUser> {
    const user = { id: randomUUID(), role: UserRole.STUDENT, ...data };
    this.users.set(user.id, user);
    const { passwordHash: _, ...publicUser } = user;
    return Promise.resolve(publicUser);
  }

  createSession(
    id: string,
    userId: string,
    refreshTokenHash: string,
    expiresAt: Date,
  ): Promise<void> {
    this.sessions.set(id, { id, userId, refreshTokenHash, expiresAt });
    return Promise.resolve();
  }

  findSessionById(id: string): Promise<SessionRecord | null> {
    const session = this.sessions.get(id);
    return Promise.resolve(session ? { ...session } : null);
  }

  deleteSession(id: string): Promise<void> {
    this.sessions.delete(id);
    return Promise.resolve();
  }

  rotateRefreshToken(
    id: string,
    oldRefreshTokenHash: string,
    newRefreshTokenHash: string,
    expiresAt: Date,
  ): Promise<boolean> {
    const session = this.sessions.get(id);
    if (!session || session.refreshTokenHash !== oldRefreshTokenHash) {
      return Promise.resolve(false);
    }
    this.sessions.set(id, {
      ...session,
      refreshTokenHash: newRefreshTokenHash,
      expiresAt,
    });
    return Promise.resolve(true);
  }
}
