import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import type { EnvironmentVariables } from '../config/env.validation.js';
import {
  AI_CLIENT,
  AI_MAX_RETRIES,
  AI_TIMEOUT_MS,
  OPENROUTER_BASE_URL,
} from './ai.constants.js';
import { AiService } from './ai.service.js';

/**
 * Wraps the AI provider. The SDK client is a factory provider: Nest calls useFactory
 * once, injecting ConfigService, and hands the result to anything that asks for
 * AI_CLIENT. Tests replace AI_CLIENT (or AiService) so no real call is made.
 * Docs: https://docs.nestjs.com/fundamentals/custom-providers#factory-providers-usefactory
 */
@Module({
  providers: [
    {
      provide: AI_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) =>
        new OpenAI({
          baseURL: OPENROUTER_BASE_URL,
          apiKey: config.getOrThrow('OPENROUTER_KEY', { infer: true }),
          timeout: AI_TIMEOUT_MS,
          maxRetries: AI_MAX_RETRIES,
        }),
    },
    AiService,
  ],
  exports: [AiService],
})
export class AiModule {}
