import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { WebModule } from '../web/web.module.js';
import { CatalogExtractor } from './catalog-extractor.service.js';
import { CatalogProcessor } from './catalog.processor.js';
import { CATALOG_QUEUE, CatalogQueue } from './catalog.queue.js';
import { CatalogRepository } from './catalog.repository.js';

/**
 * Course catalog extraction in the background. Other modules only see CatalogQueue
 * (to enqueue); the worker and the extraction steps stay inside this module.
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: CATALOG_QUEUE }),
    AiModule,
    WebModule,
    StorageModule,
  ],
  providers: [
    CatalogQueue,
    CatalogExtractor,
    CatalogRepository,
    CatalogProcessor,
  ],
  exports: [CatalogQueue],
})
export class CatalogModule {}
