import type { Request } from 'express';
import type { Session, User } from '../generated/prisma/client.js';
import type { UserRole } from '../generated/prisma/enums.js';

/** A user as it is sent to the client (v1: PublicUser / UserDto). Never the password hash. */
export type PublicUser = Pick<User, 'id' | 'name' | 'email' | 'role'>;

/** Only the login check needs the hash, so only findUserByEmail returns it. */
export type UserWithPassword = PublicUser & Pick<User, 'passwordHash'>;

export type SessionRecord = Pick<
  Session,
  'id' | 'userId' | 'refreshTokenHash' | 'expiresAt'
>;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

/** What signup and login return to the controller; the refresh token goes in a cookie. */
export interface AuthResult extends AuthTokens {
  user: PublicUser;
}

/** The logged-in user the access-token guard puts on the request (v1: res.locals.user). */
export interface AuthUser {
  id: string;
  role: UserRole;
}

/** An Express request after the access-token guard ran. */
export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}
