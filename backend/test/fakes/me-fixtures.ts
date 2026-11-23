import type { UserWithProfile } from '../../src/me/me.repository.js';
import {
  DegreeType,
  UserRole,
  type YearOfStudy,
} from '../../src/generated/prisma/enums.js';

type Profile = NonNullable<UserWithProfile['studentProfile']>;
type University = NonNullable<Profile['university']>;
type Source = University['sources'][number];

export const completedSource = (
  uploadedById: string | null = null,
): Source => ({
  errorMessage: null,
  lastProcessedAt: new Date('2026-10-01T00:00:00Z'),
  lastFetchedAt: new Date('2026-10-01T00:00:00Z'),
  uploadedById,
});

export const pendingSource = (): Source => ({
  errorMessage: null,
  lastProcessedAt: null,
  lastFetchedAt: null,
  uploadedById: null,
});

export const liu = (sources: Source[] = [completedSource()]): University => ({
  id: 'uni-liu',
  name: 'Lebanese International University',
  shortName: 'LIU',
  country: 'Lebanon',
  city: 'Beirut',
  website: 'https://liu.edu.lb',
  catalogYear: '2025-2026',
  sources,
});

export const computerScience = (): NonNullable<Profile['major']> => ({
  id: 'major-cs',
  universityId: 'uni-liu',
  name: 'Computer Science',
  degreeType: DegreeType.BACHELOR,
  totalRequiredCredits: 99,
});

/** A student row as findUserWithProfile returns it. Override any part of the profile. */
export const student = (
  id: string,
  profile: Partial<Profile> | null = {},
): UserWithProfile => ({
  id,
  name: 'Sara Haddad',
  email: `${id}@liu.edu.lb`,
  role: UserRole.STUDENT,
  studentProfile:
    profile === null
      ? null
      : {
          yearOfStudy: null as YearOfStudy | null,
          onboardingCompletedAt: null,
          university: null,
          major: null,
          _count: { documents: 0 },
          ...profile,
        },
});

export const admin = (id: string): UserWithProfile => ({
  id,
  name: 'Admin',
  email: `${id}@liu.edu.lb`,
  role: UserRole.ADMIN,
  studentProfile: null,
});
