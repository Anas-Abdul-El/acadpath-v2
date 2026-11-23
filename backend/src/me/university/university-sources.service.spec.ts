import { Test } from '@nestjs/testing';
import { UnprocessableEntityException } from '@nestjs/common';
import { CatalogQueue } from '../../catalog/catalog.queue.js';
import { ProcessingStatus, SourceType } from '../../generated/prisma/enums.js';
import { StorageService } from '../../storage/storage.service.js';
import type { ValidatedFile } from '../../common/uploads/uploaded-files.pipe.js';
import { fileBytes } from '../../../test/fixtures/files.js';
import { InMemoryStorage } from '../../../test/fakes/in-memory-storage.js';
import { UniversityRepository } from './university.repository.js';
import { UniversitySourcesService } from './university-sources.service.js';

const selection = {
  university: {
    id: 'uni-liu',
    name: 'Lebanese International University',
    city: 'Beirut',
    country: 'Lebanon',
  },
  major: {
    id: 'major-cs',
    name: 'Computer Science',
    catalogStatus: ProcessingStatus.FAILED,
  },
};
const pdf: ValidatedFile = {
  originalName: 'study plan.pdf',
  size: 73,
  buffer: fileBytes.pdf(),
  kind: 'PDF',
  mimeType: 'application/pdf',
};
const sourceRow = (
  id: string,
  over: Partial<Record<string, unknown>> = {},
) => ({
  id,
  title: 'study plan.pdf',
  sourceType: SourceType.PDF,
  errorMessage: null,
  lastFetchedAt: new Date('2026-11-23T10:00:00Z'),
  lastProcessedAt: null,
  createdAt: new Date('2026-11-23T10:00:00Z'),
  ...over,
});

describe('UniversitySourcesService', () => {
  const repo = {
    findSourcesSelection: vi.fn(),
    createUploadedSources: vi.fn(),
    markMajorPendingIfIncomplete: vi.fn(),
    markSourcesFailed: vi.fn(),
    listSources: vi.fn(),
  };
  const queue = { enqueueUploadedSources: vi.fn() };
  let storage: InMemoryStorage;
  let service: UniversitySourcesService;

  beforeEach(async () => {
    vi.clearAllMocks();
    storage = new InMemoryStorage();
    repo.findSourcesSelection.mockResolvedValue(selection);
    repo.createUploadedSources.mockResolvedValue([sourceRow('src-1')]);

    const moduleRef = await Test.createTestingModule({
      providers: [
        UniversitySourcesService,
        { provide: UniversityRepository, useValue: repo },
        { provide: StorageService, useValue: storage },
        { provide: CatalogQueue, useValue: queue },
      ],
    }).compile();
    service = moduleRef.get(UniversitySourcesService);
  });

  describe('upload', () => {
    it('answers 422 without a selected university and major', async () => {
      repo.findSourcesSelection.mockResolvedValue({
        university: selection.university,
        major: null,
      });

      const attempt = service.upload('u1', [pdf]);
      await expect(attempt).rejects.toThrow(UnprocessableEntityException);
      await expect(attempt).rejects.toThrow('Select your university first');
      expect(storage.objects.size).toBe(0);
    });

    it("stores the files in the university's folder and records them as uploaded by the student", async () => {
      await service.upload('u1', [pdf]);

      const [universityId, userId, files] = repo.createUploadedSources.mock
        .calls[0] as [
        string,
        string,
        { title: string; url: string; sourceType: string }[],
      ];
      expect(universityId).toBe('uni-liu');
      expect(userId).toBe('u1');
      expect(files).toEqual([
        {
          title: 'study plan.pdf',
          url: expect.stringMatching(/^sources\/uni-liu\/[0-9a-f-]{36}\.pdf$/),
          sourceType: 'PDF',
        },
      ]);
      expect(storage.objects.has(files[0].url)).toBe(true);
    });

    it('shows the major as processing and queues the extraction', async () => {
      const result = await service.upload('u1', [pdf]);

      expect(repo.markMajorPendingIfIncomplete).toHaveBeenCalledWith(
        'major-cs',
      );
      expect(queue.enqueueUploadedSources).toHaveBeenCalledWith({
        majorId: 'major-cs',
        universityId: 'uni-liu',
        universityName: 'Lebanese International University',
        city: 'Beirut',
        country: 'Lebanon',
        majorName: 'Computer Science',
        sourceIds: ['src-1'],
      });
      expect(result).toEqual([
        {
          id: 'src-1',
          title: 'study plan.pdf',
          sourceType: 'PDF',
          status: 'PROCESSING',
          errorMessage: null,
          createdAt: '2026-11-23T10:00:00.000Z',
        },
      ]);
    });

    it('answers 503 and marks the sources failed when the job cannot be queued', async () => {
      queue.enqueueUploadedSources.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(service.upload('u1', [pdf])).rejects.toThrow(
        'Catalog extraction is unavailable, try again later',
      );
      expect(repo.markSourcesFailed).toHaveBeenCalledWith(
        ['src-1'],
        'Processing could not start, upload the files again',
      );
    });
  });

  describe('list', () => {
    it('answers 422 without a selected university', async () => {
      repo.findSourcesSelection.mockResolvedValue(null);

      await expect(service.list('u1')).rejects.toThrow(
        'Select your university first',
      );
    });

    it("lists the university's sources with their processing status", async () => {
      repo.listSources.mockResolvedValue([
        sourceRow('a', { lastProcessedAt: new Date() }),
        sourceRow('b', { errorMessage: 'Could not read b.pdf' }),
        sourceRow('c'),
      ]);

      const result = await service.list('u1');

      expect(repo.listSources).toHaveBeenCalledWith('uni-liu');
      expect(result.map((s) => [s.id, s.status, s.errorMessage])).toEqual([
        ['a', 'COMPLETED', null],
        ['b', 'FAILED', 'Could not read b.pdf'],
        ['c', 'PROCESSING', null],
      ]);
    });
  });
});
