import { Module } from '@nestjs/common';
import { MeController } from './me.controller.js';
import { MeRepository } from './me.repository.js';
import { MeService } from './me.service.js';

/**
 * The logged-in user's own data. Guards and @CurrentUser come from the auth feature
 * but need no import here: the guards are global (APP_GUARD) and decorators are plain
 * functions. PrismaService is global.
 */
@Module({
  controllers: [MeController],
  providers: [MeService, MeRepository],
})
export class MeModule {}
