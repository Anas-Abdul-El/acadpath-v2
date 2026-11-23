import { Test } from '@nestjs/testing';
import { ServiceUnavailableException } from '@nestjs/common';
import { CatalogQueue } from '../../catalog/catalog.queue.js';
import { DegreeType, ProcessingStatus } from '../../generated/prisma/enums.js';
import { UniversityRepository } from './university.repository.js';
import { UniversitySelectionService } from './university-selection.service.js';

const body = {
  name: 'Lebanese International University',
  country: 'Lebanon',
  city: 'Beirut',
  major: 'Computer Science',
};

const university = {
  id: 'uni-liu',
  name: 'Lebanese International University',
  shortName: 'LIU',
  country: 'Lebanon',
  city: 'Beirut',
  website: null,
  catalogYear: null,
};

const major = (
  catalogStatus: ProcessingStatus,
  catalogError: string | null = null,
) => ({
  id: 'major-cs',
  universityId: 'uni-liu',
  name: 'Computer Science',
  degreeType: DegreeType.BACHELOR,
  totalRequiredCredits: null,
  catalogStatus,
  catalogError,
});

describe('UniversitySelectionService', () => {
  const repo = {
    listUniversities: vi.fn(),
    upsertUniversity: vi.fn(),
    findOrCreateMajor: vi.fn(),
    saveSelection: vi.fn(),
    markMajorPending: vi.fn(),
    getCatalogSummary: vi.fn(),
  };
  const queue = { enqueue: vi.fn() };
  let service: UniversitySelectionService;

  beforeEach(async () => {
    vi.clearAllMocks();
    repo.listUniversities.mockResolvedValue([university]);
    repo.upsertUniversity.mockResolvedValue(university);
    repo.saveSelection.mockResolvedValue({ previousUniversityId: null });
    repo.getCatalogSummary.mockResolvedValue({
      university,
      title: null,
      source: null,
      courseCount: 0,
      majorCount: 1,
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        UniversitySelectionService,
        { provide: UniversityRepository, useValue: repo },
        { provide: CatalogQueue, useValue: queue },
      ],
    }).compile();
    service = moduleRef.get(UniversitySelectionService);
  });

  it('uses an existing university instead of creating a duplicate', async () => {
    repo.findOrCreateMajor.mockResolvedValue(major(ProcessingStatus.COMPLETED));

    await service.select('s1', { ...body, name: 'liu' });

    expect(repo.upsertUniversity).not.toHaveBeenCalled();
    expect(repo.findOrCreateMajor).toHaveBeenCalledWith(
      'uni-liu',
      'Computer Science',
    );
  });

  it('creates a new university with whitespace collapsed', async () => {
    repo.listUniversities.mockResolvedValue([]);
    repo.findOrCreateMajor.mockResolvedValue(major(ProcessingStatus.PENDING));

    await service.select('s1', {
      ...body,
      name: 'Some   New University',
      city: ' Tyre ',
    });

    expect(repo.upsertUniversity).toHaveBeenCalledWith({
      name: 'Some New University',
      country: 'Lebanon',
      city: 'Tyre',
    });
  });

  it('saves the selection for the logged-in student only', async () => {
    repo.findOrCreateMajor.mockResolvedValue(major(ProcessingStatus.COMPLETED));

    await service.select('s1', body);

    expect(repo.saveSelection).toHaveBeenCalledWith(
      's1',
      'uni-liu',
      'major-cs',
    );
  });

  it('does not enqueue a major whose catalog is already extracted', async () => {
    repo.findOrCreateMajor.mockResolvedValue(major(ProcessingStatus.COMPLETED));

    const result = await service.select('s1', body);

    expect(queue.enqueue).not.toHaveBeenCalled();
    expect(result.catalog.status).toBe('AVAILABLE');
  });

  it('does not enqueue a major that is already being processed', async () => {
    repo.findOrCreateMajor.mockResolvedValue(
      major(ProcessingStatus.PROCESSING),
    );

    const result = await service.select('s1', body);

    expect(queue.enqueue).not.toHaveBeenCalled();
    expect(result.catalog.status).toBe('PROCESSING');
  });

  it.each([ProcessingStatus.PENDING, ProcessingStatus.FAILED])(
    'enqueues extraction for a %s major and reports PROCESSING',
    async (status) => {
      repo.findOrCreateMajor.mockResolvedValue(major(status, 'old error'));

      const result = await service.select('s1', body);

      expect(repo.markMajorPending).toHaveBeenCalledWith('major-cs');
      expect(queue.enqueue).toHaveBeenCalledWith({
        majorId: 'major-cs',
        universityId: 'uni-liu',
        universityName: 'Lebanese International University',
        city: 'Beirut',
        country: 'Lebanon',
        majorName: 'Computer Science',
      });
      expect(result.catalog).toMatchObject({
        status: 'PROCESSING',
        error: null,
      });
    },
  );

  it('answers 503 when the job cannot be queued', async () => {
    repo.findOrCreateMajor.mockResolvedValue(major(ProcessingStatus.PENDING));
    queue.enqueue.mockRejectedValue(
      new Error('connect ECONNREFUSED 127.0.0.1:6379'),
    );

    await expect(service.select('s1', body)).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('returns the university, the major without internal fields, and whether it replaced another', async () => {
    repo.findOrCreateMajor.mockResolvedValue(major(ProcessingStatus.COMPLETED));
    repo.saveSelection.mockResolvedValue({ previousUniversityId: 'uni-old' });
    repo.getCatalogSummary.mockResolvedValue({
      university,
      title: 'CS Catalog',
      source: 'liu.edu.lb',
      courseCount: 40,
      majorCount: 3,
    });

    await expect(service.select('s1', body)).resolves.toEqual({
      university,
      major: {
        id: 'major-cs',
        universityId: 'uni-liu',
        name: 'Computer Science',
        degreeType: 'BACHELOR',
        totalRequiredCredits: null,
      },
      catalog: {
        status: 'AVAILABLE',
        error: null,
        title: 'CS Catalog',
        source: 'liu.edu.lb',
        courseCount: 40,
        majorCount: 3,
      },
      replaced: true,
    });
  });

  it('does not count re-selecting the same university as a replacement', async () => {
    repo.findOrCreateMajor.mockResolvedValue(major(ProcessingStatus.COMPLETED));
    repo.saveSelection.mockResolvedValue({ previousUniversityId: 'uni-liu' });

    expect((await service.select('s1', body)).replaced).toBe(false);
  });
});
