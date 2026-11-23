import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module.js';
import { MeController } from './me.controller.js';
import { MeRepository } from './me.repository.js';
import { MeService } from './me.service.js';
import { UniversitySelectionService } from './university/university-selection.service.js';
import { UniversityRepository } from './university/university.repository.js';

/**
 * The logged-in user's own data. Guards and @CurrentUser come from the auth feature
 * but need no import here: the guards are global (APP_GUARD) and decorators are plain
 * functions. PrismaService is global. CatalogModule is imported for CatalogQueue,
 * the only provider it exports.
 */
@Module({
  imports: [CatalogModule],
  controllers: [MeController],
  providers: [
    MeService,
    MeRepository,
    UniversitySelectionService,
    UniversityRepository,
  ],
})
export class MeModule {}
