import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '../generated/prisma/enums.js';
import { TokensService } from './tokens.service.js';

const ACCESS_SECRET = 'a'.repeat(40);
const REFRESH_SECRET = 'r'.repeat(40);

describe('TokensService', () => {
  const jwt = new JwtService();
  const tokens = new TokensService(
    jwt,
    new ConfigService({
      ACCESS_TOKEN_SECRET: ACCESS_SECRET,
      REFRESH_TOKEN_SECRET: REFRESH_SECRET,
    }),
  );
  const user = { id: 'user-1', role: UserRole.STUDENT };

  describe('signTokens', () => {
    it('signs an access token with sub and role, valid for 1 hour', () => {
      const { accessToken } = tokens.signTokens(user, 'session-1');

      const payload = jwt.verify<{
        sub: string;
        role: string;
        exp: number;
        iat: number;
      }>(accessToken, { secret: ACCESS_SECRET });
      expect(payload).toMatchObject({ sub: 'user-1', role: 'STUDENT' });
      expect(payload.exp - payload.iat).toBe(60 * 60);
    });

    it('signs a refresh token with the session id and a unique jti, valid for 7 days', () => {
      const first = tokens.signTokens(user, 'session-1');
      const second = tokens.signTokens(user, 'session-1');

      const payload = jwt.verify<{
        sid: string;
        jti: string;
        exp: number;
        iat: number;
      }>(first.refreshToken, { secret: REFRESH_SECRET });
      expect(payload.sid).toBe('session-1');
      expect(payload.exp - payload.iat).toBe(7 * 24 * 60 * 60);
      // Two tokens issued in the same second still differ.
      expect(first.refreshToken).not.toBe(second.refreshToken);
    });
  });

  describe('verify', () => {
    it('returns the payload of a valid token of the expected type', () => {
      const { refreshToken } = tokens.signTokens(user, 'session-1');

      expect(tokens.verify(refreshToken, 'refresh')).toMatchObject({
        sub: 'user-1',
        sid: 'session-1',
      });
    });

    it('refuses a token of the other type (different secret)', () => {
      const { accessToken, refreshToken } = tokens.signTokens(user, 's');

      expect(() => tokens.verify(accessToken, 'refresh')).toThrow(
        UnauthorizedException,
      );
      expect(() => tokens.verify(refreshToken, 'access')).toThrow(
        UnauthorizedException,
      );
    });

    it('refuses an expired token', () => {
      const expired = jwt.sign(
        { sub: 'user-1', exp: Math.floor(Date.now() / 1000) - 10 },
        { secret: ACCESS_SECRET },
      );

      expect(() => tokens.verify(expired, 'access')).toThrow(
        'Invalid or expired token',
      );
    });

    it('refuses an unsigned ("alg": "none") token', () => {
      const header = Buffer.from('{"alg":"none","typ":"JWT"}').toString(
        'base64url',
      );
      const body = Buffer.from('{"sub":"user-1","role":"ADMIN"}').toString(
        'base64url',
      );

      expect(() => tokens.verify(`${header}.${body}.`, 'access')).toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('getTokenSignature', () => {
    it('returns the third segment of the JWT', () => {
      expect(TokensService.getTokenSignature('aaa.bbb.ccc')).toBe('ccc');
    });

    it('returns an empty string for a malformed token', () => {
      expect(TokensService.getTokenSignature('nope')).toBe('');
    });
  });
});
