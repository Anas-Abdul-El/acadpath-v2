import { Test } from '@nestjs/testing';
import {
  ForbiddenException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { YearOfStudy } from '../generated/prisma/enums.js';
import {
  admin,
  completedSource,
  computerScience,
  liu,
  pendingSource,
  student,
} from '../../test/fakes/me-fixtures.js';
import { MeRepository } from './me.repository.js';
import { MeService } from './me.service.js';

describe('MeService', () => {
  const repo = {
    findUserWithProfile: vi.fn(),
    upsertProfile: vi.fn(),
    completeOnboarding: vi.fn(),
  };
  let service: MeService;

  beforeEach(async () => {
    vi.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [MeService, { provide: MeRepository, useValue: repo }],
    }).compile();
    service = moduleRef.get(MeService);
  });

  describe('getMe', () => {
    it('answers 401 when the token belongs to a user that no longer exists', async () => {
      repo.findUserWithProfile.mockResolvedValue(null);

      await expect(service.getMe('gone')).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.getMe('gone')).rejects.toThrow('User not found');
    });

    it('gives an admin no profile and no onboarding', async () => {
      repo.findUserWithProfile.mockResolvedValue(admin('a1'));

      await expect(service.getMe('a1')).resolves.toEqual({
        user: {
          id: 'a1',
          name: 'Admin',
          email: 'a1@liu.edu.lb',
          role: 'ADMIN',
        },
        profile: null,
        onboarding: null,
      });
    });

    it('describes a brand-new student with no profile row yet', async () => {
      repo.findUserWithProfile.mockResolvedValue(student('s1', null));

      const me = await service.getMe('s1');

      expect(me.profile).toEqual({
        university: null,
        major: null,
        yearOfStudy: null,
        onboardingCompletedAt: null,
      });
      expect(me.onboarding).toEqual({
        universitySelected: false,
        catalogStatus: null,
        universityDocumentsUploaded: false,
        yearOfStudySelected: false,
        // No year chosen yet is not NEW_STUDENT, so a transcript is required (as in v1).
        transcriptRequired: true,
        transcriptUploaded: false,
        completed: false,
      });
    });

    it('describes a student with a university, major, year and transcript', async () => {
      const completedAt = new Date('2026-11-01T10:00:00Z');
      repo.findUserWithProfile.mockResolvedValue(
        student('s1', {
          university: liu([completedSource('s1')]),
          major: computerScience(),
          yearOfStudy: YearOfStudy.YEAR_2,
          onboardingCompletedAt: completedAt,
          _count: { documents: 1 },
        }),
      );

      const me = await service.getMe('s1');

      // The sources are only used for the status: they are not sent to the client.
      expect(me.profile?.university).toEqual({
        id: 'uni-liu',
        name: 'Lebanese International University',
        shortName: 'LIU',
        country: 'Lebanon',
        city: 'Beirut',
        website: 'https://liu.edu.lb',
        catalogYear: '2025-2026',
      });
      expect(me.profile?.major).toEqual(computerScience());
      expect(me.profile?.onboardingCompletedAt).toBe(
        '2026-11-01T10:00:00.000Z',
      );
      expect(me.onboarding).toEqual({
        universitySelected: true,
        catalogStatus: 'AVAILABLE',
        universityDocumentsUploaded: true,
        yearOfStudySelected: true,
        transcriptRequired: true,
        transcriptUploaded: true,
        completed: true,
      });
    });

    it('only counts university documents this student uploaded', async () => {
      repo.findUserWithProfile.mockResolvedValue(
        student('s1', { university: liu([completedSource('someone-else')]) }),
      );

      const me = await service.getMe('s1');
      expect(me.onboarding?.universityDocumentsUploaded).toBe(false);
    });

    it('does not require a transcript from a new student', async () => {
      repo.findUserWithProfile.mockResolvedValue(
        student('s1', { yearOfStudy: YearOfStudy.NEW_STUDENT }),
      );

      const me = await service.getMe('s1');
      expect(me.onboarding?.transcriptRequired).toBe(false);
    });
  });

  describe('updateYearOfStudy', () => {
    it('saves the year and says whether a transcript is required', async () => {
      await expect(
        service.updateYearOfStudy('s1', YearOfStudy.NEW_STUDENT),
      ).resolves.toEqual({
        yearOfStudy: 'NEW_STUDENT',
        transcriptRequired: false,
      });
      expect(repo.upsertProfile).toHaveBeenCalledWith('s1', {
        yearOfStudy: 'NEW_STUDENT',
      });
    });
  });

  describe('completeOnboarding', () => {
    const ready = {
      university: liu(),
      major: computerScience(),
      yearOfStudy: YearOfStudy.YEAR_1,
      _count: { documents: 1 },
    };

    it('marks onboarding complete when every step is done', async () => {
      repo.findUserWithProfile.mockResolvedValue(student('s1', ready));

      await service.completeOnboarding('s1');

      expect(repo.completeOnboarding).toHaveBeenCalledWith('s1');
    });

    it('does nothing when onboarding is already complete', async () => {
      repo.findUserWithProfile.mockResolvedValue(
        student('s1', { ...ready, onboardingCompletedAt: new Date() }),
      );

      await service.completeOnboarding('s1');

      expect(repo.completeOnboarding).not.toHaveBeenCalled();
    });

    it('refuses admins', async () => {
      repo.findUserWithProfile.mockResolvedValue(admin('a1'));

      await expect(service.completeOnboarding('a1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it.each([
      [
        'no university',
        { ...ready, university: null },
        'Select your university and major first',
      ],
      [
        'no major',
        { ...ready, major: null },
        'Select your university and major first',
      ],
      [
        'a catalog that is not ready',
        { ...ready, university: liu([pendingSource()]) },
        "Your university's course catalog isn't ready yet",
      ],
      [
        'no year of study',
        { ...ready, yearOfStudy: null },
        'Select your year of study first',
      ],
      [
        'a required transcript missing',
        { ...ready, _count: { documents: 0 } },
        'Upload your transcript first',
      ],
    ])('answers 422 with %s', async (_case, profile, message) => {
      repo.findUserWithProfile.mockResolvedValue(student('s1', profile));

      const attempt = service.completeOnboarding('s1');
      await expect(attempt).rejects.toThrow(UnprocessableEntityException);
      await expect(attempt).rejects.toThrow(message);
      expect(repo.completeOnboarding).not.toHaveBeenCalled();
    });

    it('lets a new student finish without a transcript', async () => {
      repo.findUserWithProfile.mockResolvedValue(
        student('s1', {
          ...ready,
          yearOfStudy: YearOfStudy.NEW_STUDENT,
          _count: { documents: 0 },
        }),
      );

      await service.completeOnboarding('s1');

      expect(repo.completeOnboarding).toHaveBeenCalledOnce();
    });
  });
});
