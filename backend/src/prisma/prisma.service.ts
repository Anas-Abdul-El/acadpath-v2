import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import type { EnvironmentVariables } from '../config/env.validation.js';

/**
 * The database client as a Nest provider. In v1 this was a module-level singleton
 * (`libs/prisma.ts`) that every repository imported; here Nest creates one instance and
 * injects it wherever it's listed in a constructor, which also lets tests swap it out.
 *
 * Prisma 7 talks to Postgres through a driver adapter. This is a long-running server, so
 * node-postgres (@prisma/adapter-pg) keeps a connection pool open across requests. The
 * pool connects lazily on the first query, as in v1.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(config: ConfigService<EnvironmentVariables, true>) {
    super({
      adapter: new PrismaPg({
        connectionString: config.getOrThrow('DATABASE_URL', { infer: true }),
      }),
    });
  }

  // Lifecycle hook: Nest calls it on app.close() (and on SIGTERM when shutdown hooks
  // are enabled), so open connections are released instead of cut off.
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
