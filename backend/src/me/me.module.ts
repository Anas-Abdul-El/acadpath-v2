import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module.js';
import { PortalModule } from '../portal/portal.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { TranscriptsModule } from '../transcripts/transcripts.module.js';
import { DocumentsController } from './documents/documents.controller.js';
import { DocumentsRepository } from './documents/documents.repository.js';
import { DocumentsService } from './documents/documents.service.js';
import { MeController } from './me.controller.js';
import { MeRepository } from './me.repository.js';
import { MeService } from './me.service.js';
import { UniversitySelectionService } from './university/university-selection.service.js';
import { UniversitySourcesController } from './university/university-sources.controller.js';
import { UniversitySourcesService } from './university/university-sources.service.js';
import { UniversityRepository } from './university/university.repository.js';

/**
 * The logged-in user's own data: profile, university, catalog sources, documents.
 *
 * Guards and @CurrentUser come from the auth feature but need no import here: the
 * guards are global (APP_GUARD) and decorators are plain functions. PrismaService is
 * global. The imported modules each export one provider: CatalogQueue,
 * TranscriptQueue and StorageService.
 */
@Module({
  imports: [CatalogModule, TranscriptsModule, StorageModule, PortalModule],
  controllers: [MeController, DocumentsController, UniversitySourcesController],
  providers: [
    MeService,
    MeRepository,
    UniversitySelectionService,
    UniversitySourcesService,
    UniversityRepository,
    DocumentsService,
    DocumentsRepository,
  ],
})
export class MeModule {}
