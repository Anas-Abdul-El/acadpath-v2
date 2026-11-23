import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import {
  validateEnv,
  type EnvironmentVariables,
} from './config/env.validation.js';
import {
  GLOBAL_RATE_LIMIT,
  POLL_RATE_LIMIT,
  RATE_LIMIT_MESSAGE,
} from './config/rate-limit.js';
import type { AuthenticatedRequest } from './auth/auth.types.js';
import { POLLED_KEY } from './common/decorators/polled.decorator.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuthModule } from './auth/auth.module.js';
import { AccessTokenGuard } from './auth/guards/access-token.guard.js';
import { RolesGuard } from './auth/guards/roles.guard.js';
import { MeModule } from './me/me.module.js';

/** Reads @Polled() metadata in the throttler options, outside Nest's DI. */
const reflector = new Reflector();

@Module({
  imports: [
    // Loads .env, validates it at boot, and makes ConfigService injectable everywhere.
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    // Counters live in memory, per app instance. With several instances behind a load
    // balancer they would need shared storage (e.g. Redis).
    ThrottlerModule.forRoot({
      throttlers: [
        {
          ...GLOBAL_RATE_LIMIT,
          // HTTP requests only: messages on an already-authenticated WebSocket (the
          // portal sends one per click or key) would use the limit up in minutes.
          skipIf: (context) => context.getType() !== 'http',
        },
        {
          ...POLL_RATE_LIMIT,
          // Only routes marked @Polled() count against this limit...
          skipIf: (context) =>
            !reflector.get<boolean | undefined>(
              POLLED_KEY,
              context.getHandler(),
            ),
          // ...and it counts per user: the access-token guard has run by now.
          getTracker: (req: Record<string, unknown>) => {
            const { user, ip } = req as unknown as AuthenticatedRequest;
            return user ? `user:${user.id}` : (ip ?? 'unknown');
          },
        },
      ],
      errorMessage: RATE_LIMIT_MESSAGE,
    }),
    // Redis connection shared by every BullMQ queue. forRootAsync waits for
    // ConfigService, so the URL comes from the validated env.
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) => ({
        connection: { url: config.getOrThrow('REDIS_URL', { infer: true }) },
      }),
    }),
    PrismaModule,
    AuthModule,
    MeModule,
  ],
  providers: [
    // Global guards, in the order they run (the order they are listed here):
    // 1. every route needs a valid access token unless marked @Public() (v1: authenticate);
    // 2. @Roles() routes check the role (v1: authorize);
    // 3. rate limits (v1: express-rate-limit). Last, so the poll limit can count per
    //    user. Guards run after middleware and before pipes, so a blocked request
    //    never reaches validation or the handler.
    { provide: APP_GUARD, useClass: AccessTokenGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
