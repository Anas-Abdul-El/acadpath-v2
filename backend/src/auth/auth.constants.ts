// Auth settings ported from v1 `config/auth.ts`. The secrets themselves come from
// ConfigService (validated in config/env.validation.ts); these are fixed values.

/** Access token lifetime: 1 hour, in seconds (jsonwebtoken reads numbers as seconds). */
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;

const REFRESH_TOKEN_TTL_DAYS = 7;
/** Refresh token lifetime, in seconds for the JWT... */
export const REFRESH_TOKEN_TTL_SECONDS = REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60;
/** ...and in milliseconds for the Session row and the cookie. */
export const REFRESH_TOKEN_TTL_MS = REFRESH_TOKEN_TTL_SECONDS * 1000;

export const REFRESH_COOKIE_NAME = 'refreshToken';
/** The browser only sends the refresh cookie to the auth routes (global prefix + controller path). */
export const REFRESH_COOKIE_PATH = '/api/auth';

/** v1's createHash used 10 rounds (its config listed 12, but nothing read that value). */
export const BCRYPT_SALT_ROUNDS = 10;
