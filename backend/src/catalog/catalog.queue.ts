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

/**
 * Puts catalog extraction jobs on the BullMQ queue (the "producer" side). The request
 * that enqueues returns at once; CatalogProcessor does the slow work.
 * Docs: https://docs.nestjs.com/techniques/queues
 */
@Injectable()
export class CatalogQueue {
  constructor(@InjectQueue(CATALOG_QUEUE) private readonly queue: Queue) {}

  async enqueue(data: CatalogJobData): Promise<void> {
    await this.queue.add('extract', data, {
      // Same id for the same major: a second request while one is queued is a no-op.
      jobId: data.majorId,
      // Transient failures (AI down, rate limit) retry after 30s, 60s.
      attempts: 3,
      backoff: { type: 'exponential', delay: 30_000 },
      // The outcome lives on the Major row, so finished jobs needn't stay in Redis.
      removeOnComplete: true,
      removeOnFail: true,
    });
  }
}
