import { SetMetadata, applyDecorators } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

export const POLLED_KEY = 'polled';

/**
 * For GET routes the frontend polls every few seconds while uploads are processing
 * (v1: pollLimiter). They skip the global per-IP limit, which polling would use up in
 * minutes, and get the "poll" limit instead: 600 per user per 15 minutes.
 * applyDecorators bundles several decorators into one.
 */
export const Polled = () =>
  applyDecorators(
    SetMetadata(POLLED_KEY, true),
    SkipThrottle({ default: true }),
  );
