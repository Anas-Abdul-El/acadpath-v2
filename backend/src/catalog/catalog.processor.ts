import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { UnrecoverableError, type Job } from 'bullmq';
import { AiInvalidResponseError, AiUnavailableError } from '../ai/ai.errors.js';
import { StorageService } from '../storage/storage.service.js';
import {
  CatalogExtractor,
  UnreadableFileError,
} from './catalog-extractor.service.js';
import {
  CATALOG_JOBS,
  CATALOG_QUEUE,
  type CatalogJobData,
  type UploadedSourcesJobData,
} from './catalog.queue.js';
import { CatalogRepository } from './catalog.repository.js';

// Messages stored in the database and shown to the student. Never raw error text.
export const CATALOG_ERRORS = {
  nothingFound: 'No course information was found for this major',
  notInUploads: (major: string) =>
    `Could not find ${major} in the uploaded files`,
  invalidAi: 'The AI returned invalid course data',
  aiUnavailable: 'The AI provider failed, try again later',
  unexpected: 'Catalog extraction failed, try again later',
};

const MIME_TYPES = { PDF: 'application/pdf' } as const;

/**
 * The worker (the "consumer" side of the queue): BullMQ calls process() for each job,
 * outside any HTTP request. @Processor registers it for the catalog queue; WorkerHost
 * is the base class @nestjs/bullmq expects. Two job types share the queue:
 * - "extract": find the major's catalog on the web (PUT /me/university);
 * - "uploaded-sources": read the files a student uploaded (POST /me/university/sources).
 *
 * Retries: throwing hands the job back to BullMQ, which retries it with backoff
 * (attempts set in CatalogQueue). UnrecoverableError skips the remaining attempts:
 * used when trying again can't help.
 */
@Processor(CATALOG_QUEUE)
export class CatalogProcessor extends WorkerHost {
  private readonly logger = new Logger(CatalogProcessor.name);

  constructor(
    private readonly extractor: CatalogExtractor,
    private readonly repo: CatalogRepository,
    private readonly storage: StorageService,
  ) {
    super();
  }

  async process(job: Job<CatalogJobData>): Promise<void> {
    if (job.name === CATALOG_JOBS.uploadedSources) {
      return this.processUploads(job as Job<UploadedSourcesJobData>);
    }
    return this.processWebSearch(job);
  }

  private async processWebSearch(job: Job<CatalogJobData>): Promise<void> {
    const { data } = job;
    const fail = (error: string) => this.repo.markFailed(data.majorId, error);
    await this.repo.markProcessing(data.majorId);

    try {
      const urls = await this.extractor.findSources(data);
      const pages = await this.extractor.readSources(urls);
      const majorData = await this.extractor.extractMajorData(data, pages);

      if (majorData.courses.length === 0) {
        throw await stop(fail, CATALOG_ERRORS.nothingFound);
      }

      await this.repo.saveExtraction({
        majorId: data.majorId,
        universityId: data.universityId,
        totalRequiredCredits: majorData.major?.totalRequiredCredits ?? null,
        courses: majorData.courses,
        sources: pages,
      });
    } catch (error) {
      throw await this.handleFailure(job, error, fail);
    }
  }

  private async processUploads(
    job: Job<UploadedSourcesJobData>,
  ): Promise<void> {
    const { data } = job;
    const fail = (error: string) =>
      this.repo.markUploadFailed(data.sourceIds, data.majorId, error);
    await this.repo.markUploadProcessing(data.majorId);

    try {
      const sources = await this.repo.findUploadedSources(data.sourceIds);
      const files = await Promise.all(
        sources.map(async (source) => ({
          fileName: source.title ?? 'file',
          mimeType:
            source.sourceType === 'PDF'
              ? MIME_TYPES.PDF
              : mimeTypeFromKey(source.url),
          data: await this.storage.get(source.url),
        })),
      );
      const majorData = await this.extractor.extractFromFiles(data, files);

      // As in v1: the files must describe the selected major.
      if (!majorData.major || majorData.courses.length === 0) {
        throw await stop(fail, CATALOG_ERRORS.notInUploads(data.majorName));
      }

      await this.repo.saveUploadedExtraction({
        majorId: data.majorId,
        totalRequiredCredits: majorData.major.totalRequiredCredits,
        courses: majorData.courses,
        sourceIds: data.sourceIds,
      });
    } catch (error) {
      throw await this.handleFailure(job, error, fail);
    }
  }

  /**
   * Decides what a failure means and returns the error to rethrow: final failures are
   * recorded and stop the retries; transient ones are retried, recorded only on the
   * last attempt.
   */
  private async handleFailure(
    job: Job,
    error: unknown,
    fail: (error: string) => Promise<void>,
  ): Promise<unknown> {
    if (error instanceof UnrecoverableError) return error;
    if (error instanceof AiInvalidResponseError) {
      return stop(fail, CATALOG_ERRORS.invalidAi);
    }
    if (error instanceof UnreadableFileError) return stop(fail, error.message);

    const attempt = job.attemptsMade + 1;
    this.logger.warn(
      `Catalog job ${job.name} failed (attempt ${attempt}): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    if (attempt >= (job.opts.attempts ?? 1)) {
      await fail(
        error instanceof AiUnavailableError
          ? CATALOG_ERRORS.aiUnavailable
          : CATALOG_ERRORS.unexpected,
      );
    }
    return error;
  }
}

/** Records the failure and returns the error that tells BullMQ not to retry. */
async function stop(
  fail: (error: string) => Promise<void>,
  message: string,
): Promise<UnrecoverableError> {
  await fail(message);
  return new UnrecoverableError(message);
}

/** Image type from the storage key's extension, which the server chose at upload. */
function mimeTypeFromKey(key: string): string {
  const ext = key.split('.').pop();
  return (
    { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }[ext ?? ''] ??
    'application/octet-stream'
  );
}
