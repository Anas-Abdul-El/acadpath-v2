import { randomUUID } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { EnvironmentVariables } from '../config/env.validation.js';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
} from './auth.constants.js';
import type { AuthTokens, PublicUser } from './auth.types.js';

/**
 * The two kinds of token the API signs. Each is signed and verified with its own
 * secret, so a refresh token can never be replayed as an access token.
 */
export type TokenType = 'access' | 'refresh';

/**
 * Signs and verifies JWTs (v1: utils/token.ts + signTokens in services/auth/session.ts).
 * JwtService comes from @nestjs/jwt; it wraps jsonwebtoken, the library v1 used directly.
 */
@Injectable()
export class TokensService {
  private readonly secrets: Record<TokenType, string>;

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.secrets = {
      access: config.getOrThrow('ACCESS_TOKEN_SECRET', { infer: true }),
      refresh: config.getOrThrow('REFRESH_TOKEN_SECRET', { infer: true }),
    };
  }

  /**
   * Signs a new access/refresh pair for a session. The claims are readable by anyone,
   * so they never hold secrets.
   */
  signTokens(
    user: Pick<PublicUser, 'id' | 'role'>,
    sessionId: string,
  ): AuthTokens {
    const accessToken = this.jwt.sign(
      { sub: user.id, role: user.role },
      {
        secret: this.secrets.access,
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
        algorithm: 'HS256',
      },
    );
    // jti makes every refresh token unique, even two issued in the same second.
    const refreshToken = this.jwt.sign(
      { sub: user.id, role: user.role, sid: sessionId, jti: randomUUID() },
      {
        secret: this.secrets.refresh,
        expiresIn: REFRESH_TOKEN_TTL_SECONDS,
        algorithm: 'HS256',
      },
    );
    return { accessToken, refreshToken };
  }

  /**
   * Verifies a token of the given type and returns its claims. Any problem (bad
   * signature, expired, wrong type, alg "none") is the same 401.
   */
  verify(token: string, type: TokenType): Record<string, unknown> {
    let payload: unknown;
    try {
      // Pin the algorithm so the token can't choose how it gets checked.
      payload = this.jwt.verify(token, {
        secret: this.secrets[type],
        algorithms: ['HS256'],
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    // We only ever sign objects, so anything else isn't one of our tokens.
    if (typeof payload !== 'object' || payload === null) {
      throw new UnauthorizedException('Invalid or expired token');
    }
    return payload as Record<string, unknown>;
  }

  /**
   * The signature segment of a JWT. This is the part to hash when storing a token:
   * bcrypt only reads the first 72 bytes, which for a whole JWT is just the header and
   * the start of the payload, the same for every token of a user.
   */
  static getTokenSignature(token: string): string {
    return token.split('.')[2] ?? '';
  }
}
