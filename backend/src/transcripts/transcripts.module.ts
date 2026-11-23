import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { TranscriptProcessor } from './transcript.processor.js';
import { TRANSCRIPT_QUEUE, TranscriptQueue } from './transcript.queue.js';
import { TranscriptRepository } from './transcript.repository.js';

/** Background transcript extraction. Other modules only see TranscriptQueue. */
@Module({
  imports: [
    BullModule.registerQueue({ name: TRANSCRIPT_QUEUE }),
    AiModule,
    StorageModule,
  ],
  providers: [TranscriptQueue, TranscriptProcessor, TranscriptRepository],
  exports: [TranscriptQueue],
})
export class TranscriptsModule {}
