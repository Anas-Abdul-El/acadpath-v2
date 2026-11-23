import type {
  DegreeType,
  UserRole,
  YearOfStudy,
} from '../generated/prisma/enums.js';
import type { CatalogStatus } from './catalog-status.js';

// Response shapes of the /me routes (v1: types/me.dto.d.ts, documented in dto.md).

export interface UserDto {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

export interface UniversityDto {
  id: string;
  name: string;
  shortName: string | null;
  country: string;
  city: string;
  website: string | null;
  catalogYear: string | null;
}

export interface MajorDto {
  id: string;
  universityId: string;
  name: string;
  degreeType: DegreeType;
  totalRequiredCredits: number | null;
}

export interface ProfileDto {
  university: UniversityDto | null;
  major: MajorDto | null;
  yearOfStudy: YearOfStudy | null;
  /** ISO 8601, or null while onboarding is unfinished. */
  onboardingCompletedAt: string | null;
}

/** Which onboarding steps the student has done, so the frontend knows what to show. */
export interface OnboardingDto {
  universitySelected: boolean;
  catalogStatus: CatalogStatus | null;
  universityDocumentsUploaded: boolean;
  yearOfStudySelected: boolean;
  transcriptRequired: boolean;
  transcriptUploaded: boolean;
  completed: boolean;
}

/** Admins have no student profile, so both are null for them. */
export interface MeData {
  user: UserDto;
  profile: ProfileDto | null;
  onboarding: OnboardingDto | null;
}

export interface YearOfStudyData {
  yearOfStudy: YearOfStudy;
  transcriptRequired: boolean;
}
