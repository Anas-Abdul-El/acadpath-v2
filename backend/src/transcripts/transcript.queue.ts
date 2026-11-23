import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';

export const TRANSCRIPT_QUEUE = 'transcripts';

export interface TranscriptJobData {
  /** StudentProfile id (not the user id). */
  studentId: string;
  /** The documents uploaded together, read as one transcript. */
  documentIds: string[];
}

/** Queues transcript extraction for an upload (producer side). */
@Injectable()
export class TranscriptQueue {
  constructor(@InjectQueue(TRANSCRIPT_QUEUE) private readonly queue: Queue) {}

  async enqueue(data: TranscriptJobData): Promise<void> {
    await this.queue.add('extract', data, {
      // One job per upload: the first document's id is unique.
      jobId: data.documentIds[0],
      attempts: 3,
      backoff: { type: 'exponential', delay: 30_000 },
      // The outcome lives on the document rows.
      removeOnComplete: true,
      removeOnFail: true,
    });
  }
}
