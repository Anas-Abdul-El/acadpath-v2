import { Test } from '@nestjs/testing';
import { UnrecoverableError, type Job } from 'bullmq';
import { AiInvalidResponseError, AiUnavailableError } from '../ai/ai.errors.js';
import { CatalogExtractor } from './catalog-extractor.service.js';
import { CatalogProcessor } from './catalog.processor.js';
import type { CatalogJobData } from './catalog.queue.js';
import { CatalogRepository } from './catalog.repository.js';
import { StorageService } from '../storage/storage.service.js';
import { UnreadableFileError } from './catalog-extractor.service.js';
import type { UploadedSourcesJobData } from './catalog.queue.js';

const data: CatalogJobData = {
  majorId: 'major-cs',
  universityId: 'uni-liu',
  universityName: 'Lebanese International University',
  city: 'Beirut',
  country: 'Lebanon',
  majorName: 'Computer Science',
};

/** A BullMQ job on its `attempt`-th try (1-based) out of `attempts`. */
const job = (attempt = 1, attempts = 3) =>
  ({
    data,
    attemptsMade: attempt - 1,
    opts: { attempts },
  }) as unknown as Job<CatalogJobData>;

const pages = [
  { url: 'https://liu.edu.lb/cs', type: 'html' as const, text: 'CSCI 250' },
];
const course = {
  code: 'CSCI 250',
  name: 'Data Structures',
  description: null,
  credits: 3,
  category: 'MAJOR_REQUIREMENT' as const,
  offeredTerms: [],
  prerequisites: [],
  corequisites: [],
};

describe('CatalogProcessor', () => {
  const extractor = {
    findSources: vi.fn(),
    readSources: vi.fn(),
    extractMajorData: vi.fn(),
    extractFromFiles: vi.fn(),
  };
  const repo = {
    markProcessing: vi.fn(),
    markFailed: vi.fn(),
    saveExtraction: vi.fn(),
    findUploadedSources: vi.fn(),
    markUploadProcessing: vi.fn(),
    markUploadFailed: vi.fn(),
    saveUploadedExtraction: vi.fn(),
  };
  const storage = { get: vi.fn() };
  let processor: CatalogProcessor;

  beforeEach(async () => {
    vi.clearAllMocks();
    extractor.findSources.mockResolvedValue(['https://liu.edu.lb/cs']);
    extractor.readSources.mockResolvedValue(pages);
    extractor.extractMajorData.mockResolvedValue({
      major: { name: 'Computer Science', totalRequiredCredits: 99 },
      courses: [course],
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        CatalogProcessor,
        { provide: CatalogExtractor, useValue: extractor },
        { provide: CatalogRepository, useValue: repo },
        { provide: StorageService, useValue: storage },
      ],
    }).compile();
    processor = moduleRef.get(CatalogProcessor);
  });

  it('marks the major processing, then saves the courses with their sources', async () => {
    await processor.process(job());

    expect(repo.markProcessing).toHaveBeenCalledWith('major-cs');
    expect(extractor.findSources).toHaveBeenCalledWith(data);
    expect(extractor.readSources).toHaveBeenCalledWith([
      'https://liu.edu.lb/cs',
    ]);
    expect(repo.saveExtraction).toHaveBeenCalledWith({
      majorId: 'major-cs',
      universityId: 'uni-liu',
      totalRequiredCredits: 99,
      courses: [course],
      sources: pages,
    });
    expect(repo.markFailed).not.toHaveBeenCalled();
  });

  it('fails for good when nothing about the major was found', async () => {
    extractor.extractMajorData.mockResolvedValue({ major: null, courses: [] });

    await expect(processor.process(job())).rejects.toThrow(UnrecoverableError);
    expect(repo.markFailed).toHaveBeenCalledWith(
      'major-cs',
      'No course information was found for this major',
    );
    expect(repo.saveExtraction).not.toHaveBeenCalled();
  });

  it('fails for good, without retrying, when the AI reply is invalid', async () => {
    extractor.extractMajorData.mockRejectedValue(new AiInvalidResponseError());

    await expect(processor.process(job())).rejects.toThrow(UnrecoverableError);
    expect(repo.markFailed).toHaveBeenCalledWith(
      'major-cs',
      'The AI returned invalid course data',
    );
  });

  it('leaves a transient failure to BullMQ to retry, and keeps the major processing', async () => {
    extractor.findSources.mockRejectedValue(new AiUnavailableError());

    const error: unknown = await processor
      .process(job(1, 3))
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AiUnavailableError);
    expect(error).not.toBeInstanceOf(UnrecoverableError);
    expect(repo.markFailed).not.toHaveBeenCalled();
  });

  it('marks the major failed when the last attempt fails too', async () => {
    extractor.findSources.mockRejectedValue(new AiUnavailableError());

    await expect(processor.process(job(3, 3))).rejects.toThrow(
      AiUnavailableError,
    );
    expect(repo.markFailed).toHaveBeenCalledWith(
      'major-cs',
      'The AI provider failed, try again later',
    );
  });

  it('never stores an unexpected error message, only a generic one', async () => {
    extractor.readSources.mockRejectedValue(
      new Error('db password=hunter2 refused'),
    );

    await expect(processor.process(job(3, 3))).rejects.toThrow();
    expect(repo.markFailed).toHaveBeenCalledWith(
      'major-cs',
      'Catalog extraction failed, try again later',
    );
  });

  describe("'uploaded-sources' jobs (files a student uploaded)", () => {
    const uploadData: UploadedSourcesJobData = {
      majorId: 'major-cs',
      universityId: 'uni-liu',
      universityName: 'Lebanese International University',
      city: 'Beirut',
      country: 'Lebanon',
      majorName: 'Computer Science',
      sourceIds: ['s1', 's2'],
    };
    const uploadJob = (attempt = 1, attempts = 3) =>
      ({
        name: 'uploaded-sources',
        data: uploadData,
        attemptsMade: attempt - 1,
        opts: { attempts },
      }) as unknown as Job<UploadedSourcesJobData>;

    beforeEach(() => {
      repo.findUploadedSources.mockResolvedValue([
        {
          id: 's1',
          title: 'plan.pdf',
          url: 'sources/uni-liu/a.pdf',
          sourceType: 'PDF',
        },
        {
          id: 's2',
          title: 'page.png',
          url: 'sources/uni-liu/b.png',
          sourceType: 'IMAGE',
        },
      ]);
      storage.get.mockImplementation((key: string) =>
        Promise.resolve(Buffer.from(key)),
      );
      extractor.extractFromFiles.mockResolvedValue({
        major: { name: 'Computer Science', totalRequiredCredits: 99 },
        courses: [course],
      });
    });

    it('reads the files from storage and saves the extracted courses', async () => {
      await processor.process(uploadJob());

      expect(repo.markUploadProcessing).toHaveBeenCalledWith('major-cs');
      expect(extractor.extractFromFiles).toHaveBeenCalledWith(uploadData, [
        {
          fileName: 'plan.pdf',
          mimeType: 'application/pdf',
          data: Buffer.from('sources/uni-liu/a.pdf'),
        },
        {
          fileName: 'page.png',
          mimeType: 'image/png',
          data: Buffer.from('sources/uni-liu/b.png'),
        },
      ]);
      expect(repo.saveUploadedExtraction).toHaveBeenCalledWith({
        majorId: 'major-cs',
        totalRequiredCredits: 99,
        courses: [course],
        sourceIds: ['s1', 's2'],
      });
      expect(extractor.findSources).not.toHaveBeenCalled();
    });

    it('fails for good when the files say nothing about the major', async () => {
      extractor.extractFromFiles.mockResolvedValue({
        major: null,
        courses: [],
      });

      await expect(processor.process(uploadJob())).rejects.toThrow(
        UnrecoverableError,
      );
      expect(repo.markUploadFailed).toHaveBeenCalledWith(
        ['s1', 's2'],
        'major-cs',
        'Could not find Computer Science in the uploaded files',
      );
      expect(repo.saveUploadedExtraction).not.toHaveBeenCalled();
    });

    it('fails for good on an unreadable file, naming it', async () => {
      extractor.extractFromFiles.mockRejectedValue(
        new UnreadableFileError('plan.pdf'),
      );

      await expect(processor.process(uploadJob())).rejects.toThrow(
        UnrecoverableError,
      );
      expect(repo.markUploadFailed).toHaveBeenCalledWith(
        ['s1', 's2'],
        'major-cs',
        'Could not read plan.pdf',
      );
    });

    it('retries a transient failure, failing the upload only on the last attempt', async () => {
      extractor.extractFromFiles.mockRejectedValue(new AiUnavailableError());

      await expect(processor.process(uploadJob(1, 3))).rejects.toThrow(
        AiUnavailableError,
      );
      expect(repo.markUploadFailed).not.toHaveBeenCalled();

      await expect(processor.process(uploadJob(3, 3))).rejects.toThrow(
        AiUnavailableError,
      );
      expect(repo.markUploadFailed).toHaveBeenCalledWith(
        ['s1', 's2'],
        'major-cs',
        'The AI provider failed, try again later',
      );
    });
  });
});
