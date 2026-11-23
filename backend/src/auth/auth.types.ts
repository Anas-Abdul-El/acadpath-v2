import type { Session, User } from '../generated/prisma/client.js';

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
