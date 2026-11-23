import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';

export const CATALOG_QUEUE = 'catalog';

/** What the worker needs to extract one major's catalog. */
export interface CatalogJobData {
  majorId: string;
  universityId: string;
  universityName: string;
  city: string;
  country: string;
  majorName: string;
}

/** Catalog files a student uploaded, to extract the selected major from. */
export interface UploadedSourcesJobData extends CatalogJobData {
  sourceIds: string[];
}

/** Job names on the catalog queue. */
export const CATALOG_JOBS = {
  webSearch: 'extract',
  uploadedSources: 'uploaded-sources',
} as const;

const RETRIES = {
  // Transient failures (AI down, rate limit) retry after 30s, 60s.
  attempts: 3,
  backoff: { type: 'exponential', delay: 30_000 },
  // The outcome lives in the database, so finished jobs needn't stay in Redis.
  removeOnComplete: true,
  removeOnFail: true,
} as const;

/**
 * Puts catalog extraction jobs on the BullMQ queue (the "producer" side). The request
 * that enqueues returns at once; CatalogProcessor does the slow work.
 * Docs: https://docs.nestjs.com/techniques/queues
 */
@Injectable()
export class CatalogQueue {
  constructor(@InjectQueue(CATALOG_QUEUE) private readonly queue: Queue) {}

  async enqueue(data: CatalogJobData): Promise<void> {
    await this.queue.add(CATALOG_JOBS.webSearch, data, {
      // Same id for the same major: a second request while one is queued is a no-op.
      jobId: data.majorId,
      ...RETRIES,
    });
  }

  /** One job per upload; the first source id makes its id unique. */
  async enqueueUploadedSources(data: UploadedSourcesJobData): Promise<void> {
    await this.queue.add(CATALOG_JOBS.uploadedSources, data, {
      jobId: `sources-${data.sourceIds[0]}`,
      ...RETRIES,
    });
  }
}
