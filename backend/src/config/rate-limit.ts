// Rate limits ported from v1 `config/limiter.ts` (express-rate-limit → @nestjs/throttler).
// Docs: https://docs.nestjs.com/security/rate-limiting

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

/** Every route: 100 requests per IP per 15 minutes (v1's global limiter). */
export const GLOBAL_RATE_LIMIT = { ttl: FIFTEEN_MINUTES_MS, limit: 100 };

/** Login and sign-up: 10 attempts per IP per 15 minutes, to slow down password guessing. */
export const AUTH_RATE_LIMIT = { ttl: FIFTEEN_MINUTES_MS, limit: 10 };

export const RATE_LIMIT_MESSAGE = 'Too many requests, try again later';
