import { SetMetadata } from '@nestjs/common';
import type { UserRateLimitName } from '../../config/rate-limit.js';

export const USER_RATE_LIMIT_KEY = 'userRateLimit';

/**
 * Counts the route against one of the per-user limits in USER_RATE_LIMITS, e.g.
 * `@UserRateLimit('portal')` (v1: portalLimiter). Only the throttler with that name
 * counts it, keyed by the user id from the access token. The global per-IP limit still
 * applies unless the route also skips it (see @Polled).
 */
export const UserRateLimit = (name: UserRateLimitName) =>
  SetMetadata(USER_RATE_LIMIT_KEY, name);
