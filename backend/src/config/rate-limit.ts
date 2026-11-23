// Rate limits ported from v1 `config/limiter.ts` (express-rate-limit → @nestjs/throttler).
// Docs: https://docs.nestjs.com/security/rate-limiting

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

/** Every route: 100 requests per IP per 15 minutes (v1's global limiter). */
export const GLOBAL_RATE_LIMIT = {
  name: 'default',
  ttl: FIFTEEN_MINUTES_MS,
  limit: 100,
};

/**
 * Limits counted per logged-in user, on the routes that opt in with
 * @UserRateLimit(name) (v1's limiters keyed by user id):
 * - poll: GET routes the frontend polls while uploads process (about one every 1.5 s);
 * - portal: starting the remote portal browser, which launches Chromium;
 * - ai: requests that end in an AI call.
 */
export const USER_RATE_LIMITS = {
  poll: { ttl: FIFTEEN_MINUTES_MS, limit: 600 },
  portal: { ttl: FIFTEEN_MINUTES_MS, limit: 40 },
  ai: { ttl: FIFTEEN_MINUTES_MS, limit: 30 },
} as const;

export type UserRateLimitName = keyof typeof USER_RATE_LIMITS;

/** Login and sign-up: 10 attempts per IP per 15 minutes, to slow down password guessing. */
export const AUTH_RATE_LIMIT = { ttl: FIFTEEN_MINUTES_MS, limit: 10 };

export const RATE_LIMIT_MESSAGE = 'Too many requests, try again later';
