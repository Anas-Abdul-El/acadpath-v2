import { plainToInstance, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

/** One or more origins ("https://app.example", "http://localhost:3000"), comma-separated. */
const ORIGIN_LIST =
  /^\s*https?:\/\/[a-z0-9.-]+(:\d+)?\s*(,\s*https?:\/\/[a-z0-9.-]+(:\d+)?\s*)*$/i;

/** "a, B ,.c," → ["a", "b", "c"]: for the comma-separated settings. */
export function parseList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim().toLowerCase().replace(/^\.+/, ''))
    .filter(Boolean);
}

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

  /**
   * Frontend origins, comma-separated (scheme + host + port, no path). Only these may
   * open the portal WebSocket: browsers send Origin on WebSocket handshakes, and CORS
   * doesn't cover WebSockets, so the server checks it itself.
   */
  @Matches(ORIGIN_LIST, {
    message:
      'CORS_ORIGIN must be comma-separated origins like https://app.example (no path)',
  })
  CORS_ORIGIN = 'http://localhost:3000';

  // ─── Student-portal browser (v1: config/portal.ts). Defaults target LIU. ───

  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  PORTAL_START_URL = 'https://syslbv4.liu.edu.lb/login/';

  /** Comma-separated domains the portal browser may navigate to (subdomains included). */
  @IsString()
  @MinLength(1)
  PORTAL_ALLOWED_HOSTS = 'liu.edu.lb';

  /** Browsers open at once across all students (each costs about 150 MB of RAM). */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  PORTAL_MAX_SESSIONS = 5;

  /** A portal session nobody is watching closes after this many minutes. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(120)
  PORTAL_IDLE_MINUTES = 10;

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

  /**
   * Vision-capable model on OpenRouter, for images and scanned PDFs (transcripts,
   * catalog pages). Required, with no default: pick a current model ID on OpenRouter.
   */
  @IsString()
  @MinLength(1)
  OPENROUTER_VISION_MODEL: string;

  // Object storage for uploaded files (v1: Neon Object Storage). Any S3-compatible
  // service works: AWS S3 (leave S3_ENDPOINT unset), Neon, R2, or SeaweedFS in Compose.

  /** Custom endpoint for S3-compatible services; unset means AWS S3. */
  @IsOptional()
  @IsUrl({
    protocols: ['http', 'https'],
    require_protocol: true,
    require_tld: false,
  })
  S3_ENDPOINT?: string;

  @IsString()
  @MinLength(1)
  S3_REGION = 'us-east-1';

  @IsString()
  @MinLength(1)
  S3_BUCKET: string;

  @IsString()
  @MinLength(1)
  S3_ACCESS_KEY_ID: string;

  @IsString()
  @MinLength(1)
  S3_SECRET_ACCESS_KEY: string;
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
