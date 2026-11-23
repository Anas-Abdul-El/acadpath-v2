import { plainToInstance, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

const NODE_ENVS = ['development', 'production', 'test'] as const;

/**
 * Every environment variable the app reads, with its rules. ConfigModule calls
 * validateEnv once at startup, so the server refuses to boot with a missing or weak
 * secret instead of failing on the first login (v1: config/auth.ts + config/env.ts).
 */
export class EnvironmentVariables {
  @IsIn(NODE_ENVS)
  NODE_ENV: (typeof NODE_ENVS)[number] = 'development';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT = 3000;

  @IsString()
  @MinLength(1)
  DATABASE_URL: string;

  @IsString()
  @MinLength(32, { message: '$property must be at least 32 characters' })
  ACCESS_TOKEN_SECRET: string;

  @IsString()
  @MinLength(32, { message: '$property must be at least 32 characters' })
  REFRESH_TOKEN_SECRET: string;

  @IsOptional()
  @IsString()
  CORS_ORIGIN?: string;

  /** OpenRouter API key (v1: config/ai.ts). Only the server ever sees it. */
  @IsString()
  @MinLength(1)
  OPENROUTER_KEY: string;

  /** Model ID on OpenRouter; v1's default unless overridden. */
  @IsString()
  @MinLength(1)
  OPENROUTER_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b:free';

  /** Redis for the BullMQ job queues, e.g. redis://localhost:6379. */
  @Matches(/^rediss?:\/\/.+/, {
    message: 'REDIS_URL must be a redis:// or rediss:// URL',
  })
  REDIS_URL: string;
}

export function validateEnv(
  config: Record<string, unknown>,
): EnvironmentVariables {
  // excludeExtraneousValues is not used: process.env holds many unrelated variables,
  // and ConfigService only serves the ones declared on the class anyway.
  const env = plainToInstance(EnvironmentVariables, config);
  const errors = validateSync(env, { skipMissingProperties: false });

  const messages = errors.flatMap((error) =>
    Object.values(error.constraints ?? {}),
  );
  // Separate secrets only help if they are actually different.
  if (
    env.ACCESS_TOKEN_SECRET &&
    env.ACCESS_TOKEN_SECRET === env.REFRESH_TOKEN_SECRET
  ) {
    messages.push(
      'ACCESS_TOKEN_SECRET and REFRESH_TOKEN_SECRET must be different',
    );
  }

  if (messages.length > 0) {
    throw new Error(
      `Invalid environment variables:\n- ${messages.join('\n- ')}`,
    );
  }
  return env;
}
