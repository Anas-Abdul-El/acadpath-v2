import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { UnrecoverableError, type Job } from 'bullmq';
import { AiInvalidResponseError, AiUnavailableError } from '../ai/ai.errors.js';
import { CatalogExtractor } from './catalog-extractor.service.js';
import { CATALOG_QUEUE, type CatalogJobData } from './catalog.queue.js';
import { CatalogRepository } from './catalog.repository.js';

// Messages stored on the major and shown to the student. Never raw error text.
export const CATALOG_ERRORS = {
  nothingFound: 'No course information was found for this major',
  invalidAi: 'The AI returned invalid course data',
  aiUnavailable: 'The AI provider failed, try again later',
  unexpected: 'Catalog extraction failed, try again later',
} as const;

/**
 * The worker (the "consumer" side of the queue): BullMQ calls process() for each job,
 * outside any HTTP request. @Processor registers it for the catalog queue; WorkerHost
 * is the base class @nestjs/bullmq expects.
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
  ) {
    super();
  }

  async process(job: Job<CatalogJobData>): Promise<void> {
    const { data } = job;
    await this.repo.markProcessing(data.majorId);

    try {
      const urls = await this.extractor.findSources(data);
      const pages = await this.extractor.readSources(urls);
      const majorData = await this.extractor.extractMajorData(data, pages);

      if (majorData.courses.length === 0) {
        await this.repo.markFailed(data.majorId, CATALOG_ERRORS.nothingFound);
        throw new UnrecoverableError(CATALOG_ERRORS.nothingFound);
      }

      await this.repo.saveExtraction({
        majorId: data.majorId,
        universityId: data.universityId,
        totalRequiredCredits: majorData.major?.totalRequiredCredits ?? null,
        courses: majorData.courses,
        sources: pages,
      });
    } catch (error) {
      if (error instanceof UnrecoverableError) throw error;

      if (error instanceof AiInvalidResponseError) {
        await this.repo.markFailed(data.majorId, CATALOG_ERRORS.invalidAi);
        throw new UnrecoverableError(CATALOG_ERRORS.invalidAi);
      }

      // Transient: let BullMQ retry. Only the last attempt marks the major failed.
      const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      this.logger.warn(
        `Catalog job for major ${data.majorId} failed (attempt ${job.attemptsMade + 1}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      if (isLastAttempt) {
        await this.repo.markFailed(
          data.majorId,
          error instanceof AiUnavailableError
            ? CATALOG_ERRORS.aiUnavailable
            : CATALOG_ERRORS.unexpected,
        );
      }
      throw error;
    }
  }
}
