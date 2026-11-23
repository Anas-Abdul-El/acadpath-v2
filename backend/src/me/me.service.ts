import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { UserRole, YearOfStudy } from '../generated/prisma/enums.js';
import { getCatalogStatus } from './catalog-status.js';
import { MeRepository } from './me.repository.js';
import type { MeData, UniversityDto, YearOfStudyData } from './me.types.js';

/**
 * The /me rules (v1: services/me/{get-me,update-profile,update-year-of-study,
 * complete-onboarding}.service.ts). Every method acts on the user id it's given, which
 * the controller takes from the verified access token.
 */
@Injectable()
export class MeService {
  constructor(private readonly repo: MeRepository) {}

  async getMe(userId: string): Promise<MeData> {
    const row = await this.repo.findUserWithProfile(userId);
    // A valid token for a user that no longer exists.
    if (!row) throw new UnauthorizedException('User not found');

    const { studentProfile, ...user } = row;
    if (user.role === UserRole.ADMIN) {
      return { user, profile: null, onboarding: null };
    }

    const university = studentProfile?.university ?? null;
    const yearOfStudy = studentProfile?.yearOfStudy ?? null;
    const onboardingCompletedAt = studentProfile?.onboardingCompletedAt ?? null;
    const transcriptCount = studentProfile?._count.documents ?? 0;

    // The sources are only used to work out the statuses below; they aren't sent.
    const sources = university?.sources ?? [];
    let universityDto: UniversityDto | null = null;
    if (university) {
      const { sources: _, ...rest } = university;
      universityDto = rest;
    }

    return {
      user,
      profile: {
        university: universityDto,
        major: studentProfile?.major ?? null,
        yearOfStudy,
        onboardingCompletedAt: onboardingCompletedAt?.toISOString() ?? null,
      },
      onboarding: {
        universitySelected: university !== null,
        catalogStatus: university ? getCatalogStatus(sources) : null,
        universityDocumentsUploaded: sources.some(
          (source) => source.uploadedById === user.id,
        ),
        yearOfStudySelected: yearOfStudy !== null,
        // As in v1, only a NEW_STUDENT skips the transcript, so an unset year requires one.
        transcriptRequired: yearOfStudy !== YearOfStudy.NEW_STUDENT,
        transcriptUploaded: transcriptCount > 0,
        completed: onboardingCompletedAt !== null,
      },
    };
  }

  async updateProfile(
    userId: string,
    data: { yearOfStudy?: YearOfStudy },
  ): Promise<MeData> {
    await this.repo.upsertProfile(userId, data);
    return this.getMe(userId);
  }

  /** Changing the year never removes uploaded documents; it only changes whether a transcript is required. */
  async updateYearOfStudy(
    userId: string,
    yearOfStudy: YearOfStudy,
  ): Promise<YearOfStudyData> {
    await this.repo.upsertProfile(userId, { yearOfStudy });
    return {
      yearOfStudy,
      transcriptRequired: yearOfStudy !== YearOfStudy.NEW_STUDENT,
    };
  }

  /** Checks every onboarding step, in order, and reports the first one missing (422). */
  async completeOnboarding(userId: string): Promise<MeData> {
    const me = await this.getMe(userId);
    const { profile, onboarding } = me;
    if (!profile || !onboarding) {
      throw new ForbiddenException('Only students onboard');
    }
    if (onboarding.completed) return me;

    if (!onboarding.universitySelected || !profile.major) {
      throw new UnprocessableEntityException(
        'Select your university and major first',
      );
    }
    if (onboarding.catalogStatus !== 'AVAILABLE') {
      throw new UnprocessableEntityException(
        "Your university's course catalog isn't ready yet",
      );
    }
    if (!onboarding.yearOfStudySelected) {
      throw new UnprocessableEntityException('Select your year of study first');
    }
    if (onboarding.transcriptRequired && !onboarding.transcriptUploaded) {
      throw new UnprocessableEntityException('Upload your transcript first');
    }

    await this.repo.completeOnboarding(userId);
    return this.getMe(userId);
  }
}
