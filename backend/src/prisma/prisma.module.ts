import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

/**
 * @Global so every feature module can inject PrismaService without importing
 * PrismaModule. Nest recommends @Global sparingly; a database client used by nearly
 * every module is the standard case for it.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
