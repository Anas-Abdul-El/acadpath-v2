import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { validateEnv } from './config/env.validation.js';
import { GLOBAL_RATE_LIMIT, RATE_LIMIT_MESSAGE } from './config/rate-limit.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuthModule } from './auth/auth.module.js';

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
    PrismaModule,
    AuthModule,
  ],
  providers: [
    // APP_GUARD registers ThrottlerGuard for every route in the app (v1: app.use(limiter)).
    // Guards run after middleware and before pipes, so a blocked request never reaches
    // validation or the handler.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
