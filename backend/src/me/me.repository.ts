import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import {
  StudentDocumentType,
  type YearOfStudy,
} from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';

// Everything GET /me needs, in one query (no N+1): the user, their profile, the
// university with its sources' processing state, the major, and a transcript count.
const userWithProfileSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  studentProfile: {
    select: {
      yearOfStudy: true,
      onboardingCompletedAt: true,
      university: {
        select: {
          id: true,
          name: true,
          shortName: true,
          country: true,
          city: true,
          website: true,
          catalogYear: true,
          sources: {
            select: {
              errorMessage: true,
              lastProcessedAt: true,
              lastFetchedAt: true,
              uploadedById: true,
            },
          },
        },
      },
      major: {
        select: {
          id: true,
          universityId: true,
          name: true,
          degreeType: true,
          totalRequiredCredits: true,
          catalogStatus: true,
          catalogError: true,
        },
      },
      _count: {
        select: {
          documents: { where: { type: StudentDocumentType.TRANSCRIPT } },
        },
      },
    },
  },
} as const satisfies Prisma.UserSelect;

/** The row findUserWithProfile returns, typed by Prisma from the select above. */
export type UserWithProfile = Prisma.UserGetPayload<{
  select: typeof userWithProfileSelect;
}>;

/**
 * Database queries for the /me routes (v1: repositories/me.repo.ts). Every method takes
 * the logged-in user's id, which comes from the access token, never from the request.
 */
@Injectable()
export class MeRepository {
  constructor(private readonly prisma: PrismaService) {}

  findUserWithProfile(userId: string): Promise<UserWithProfile | null> {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: userWithProfileSelect,
    });
  }

  /** Creates the student's profile row on first write, updates it afterwards. */
  async upsertProfile(
    userId: string,
    data: { yearOfStudy?: YearOfStudy },
  ): Promise<void> {
    await this.prisma.studentProfile.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
      select: { id: true },
    });
  }

  async completeOnboarding(userId: string): Promise<void> {
    await this.prisma.studentProfile.update({
      where: { userId },
      data: { onboardingCompletedAt: new Date() },
      select: { id: true },
    });
  }
}
