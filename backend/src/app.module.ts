import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import {
  validateEnv,
  type EnvironmentVariables,
} from './config/env.validation.js';
import { GLOBAL_RATE_LIMIT, RATE_LIMIT_MESSAGE } from './config/rate-limit.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuthModule } from './auth/auth.module.js';
import { AccessTokenGuard } from './auth/guards/access-token.guard.js';
import { RolesGuard } from './auth/guards/roles.guard.js';
import { MeModule } from './me/me.module.js';

@Module({
  imports: [
    // Loads .env, validates it at boot, and makes ConfigService injectable everywhere.
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    // Counters live in memory, per app instance. With several instances behind a load
    // balancer they would need shared storage (e.g. Redis).
    ThrottlerModule.forRoot({
      throttlers: [GLOBAL_RATE_LIMIT],
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
    // APP_GUARD registers ThrottlerGuard for every route in the app (v1: app.use(limiter)).
    // Guards run after middleware and before pipes, so a blocked request never reaches
    // validation or the handler.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Then every route needs a valid access token unless it is marked @Public()
    // (v1: authenticate), and @Roles() routes check the role (v1: authorize).
    // Global guards run in the order they are listed here.
    { provide: APP_GUARD, useClass: AccessTokenGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
