import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { UserRole } from '../generated/prisma/enums.js';
import { AuthRepository } from './auth.repository.js';
import { AuthService } from './auth.service.js';
import { HashService } from './hash.service.js';
import { TokensService } from './tokens.service.js';

const user = {
  id: 'user-1',
  name: 'Sara',
  email: 'sara@liu.edu.lb',
  role: UserRole.STUDENT,
};

describe('AuthService', () => {
  // vi.fn() mocks for every repository method: no database in unit tests.
  const repo = {
    findUserByEmail: vi.fn(),
    findUserById: vi.fn(),
    createUser: vi.fn(),
    createSession: vi.fn(),
    findSessionById: vi.fn(),
    deleteSession: vi.fn(),
    rotateRefreshToken: vi.fn(),
  };
  let service: AuthService;
  let tokens: TokensService;
  let hash: HashService;

  beforeEach(async () => {
    vi.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        TokensService,
        HashService,
        JwtService,
        { provide: AuthRepository, useValue: repo },
        {
          provide: ConfigService,
          useValue: new ConfigService({
            ACCESS_TOKEN_SECRET: 'a'.repeat(40),
            REFRESH_TOKEN_SECRET: 'r'.repeat(40),
          }),
        },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
    tokens = moduleRef.get(TokensService);
    hash = moduleRef.get(HashService);
  });

  /** A session row whose stored hash matches `refreshToken`, as startSession would save it. */
  async function sessionFor(refreshToken: string, expiresAt: Date) {
    return {
      id: 'session-1',
      userId: user.id,
      refreshTokenHash: await hash.hash(
        TokensService.getTokenSignature(refreshToken),
      ),
      expiresAt,
    };
  }
  const inOneDay = () => new Date(Date.now() + 24 * 60 * 60 * 1000);

  describe('login', () => {
    it('still runs a bcrypt comparison for an unknown email, so timing does not reveal which emails exist', async () => {
      repo.findUserByEmail.mockResolvedValue(null);
      const compare = vi.spyOn(hash, 'compare');

      await expect(
        service.login({ email: 'nobody@liu.edu.lb', password: 'password1' }),
      ).rejects.toThrow('Invalid email or password');
      expect(compare).toHaveBeenCalledOnce();
    });

    it('never returns the password hash', async () => {
      repo.findUserByEmail.mockResolvedValue({
        ...user,
        passwordHash: await hash.hash('password1'),
      });

      const result = await service.login({
        email: user.email,
        password: 'password1',
      });

      expect(result.user).toEqual(user);
      expect(result.user).not.toHaveProperty('passwordHash');
    });
  });

  describe('signup', () => {
    it('creates the user with a hashed password and starts a session', async () => {
      repo.findUserByEmail.mockResolvedValue(null);
      repo.createUser.mockResolvedValue(user);

      const result = await service.signup({
        email: user.email,
        password: 'password1',
        name: 'Sara',
      });

      const [created] = repo.createUser.mock.calls[0] as [
        { passwordHash: string },
      ];
      await expect(
        hash.compare('password1', created.passwordHash),
      ).resolves.toBe(true);
      expect(repo.createSession).toHaveBeenCalledOnce();
      expect(result.user).toEqual(user);
    });
  });

  describe('refresh', () => {
    it('deletes an expired session and refuses the token', async () => {
      const { refreshToken } = tokens.signTokens(user, 'session-1');
      repo.findSessionById.mockResolvedValue(
        await sessionFor(refreshToken, new Date(Date.now() - 1000)),
      );

      await expect(service.refresh(refreshToken)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(repo.deleteSession).toHaveBeenCalledWith('session-1');
    });

    it('refuses when another refresh with the same token won the race', async () => {
      const { refreshToken } = tokens.signTokens(user, 'session-1');
      repo.findSessionById.mockResolvedValue(
        await sessionFor(refreshToken, inOneDay()),
      );
      repo.findUserById.mockResolvedValue(user);
      repo.rotateRefreshToken.mockResolvedValue(false);

      await expect(service.refresh(refreshToken)).rejects.toThrow(
        'Invalid or expired token',
      );
    });

    it('refuses when the user no longer exists', async () => {
      const { refreshToken } = tokens.signTokens(user, 'session-1');
      repo.findSessionById.mockResolvedValue(
        await sessionFor(refreshToken, inOneDay()),
      );
      repo.findUserById.mockResolvedValue(null);

      await expect(service.refresh(refreshToken)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(repo.rotateRefreshToken).not.toHaveBeenCalled();
    });

    it('swaps the stored hash only if it is still the one it checked, and extends the session', async () => {
      const { refreshToken } = tokens.signTokens(user, 'session-1');
      const session = await sessionFor(refreshToken, inOneDay());
      repo.findSessionById.mockResolvedValue(session);
      repo.findUserById.mockResolvedValue(user);
      repo.rotateRefreshToken.mockResolvedValue(true);

      const result = await service.refresh(refreshToken);

      const [id, oldHash, newHash, expiresAt] = repo.rotateRefreshToken.mock
        .calls[0] as [string, string, string, Date];
      expect(id).toBe('session-1');
      expect(oldHash).toBe(session.refreshTokenHash);
      await expect(
        hash.compare(
          TokensService.getTokenSignature(result.refreshToken),
          newHash,
        ),
      ).resolves.toBe(true);
      expect(expiresAt.getTime()).toBeGreaterThan(session.expiresAt.getTime());
    });
  });

  describe('logout', () => {
    it('does not delete the session when the token is not its current one', async () => {
      const { refreshToken } = tokens.signTokens(user, 'session-1');
      const current = tokens.signTokens(user, 'session-1').refreshToken;
      repo.findSessionById.mockResolvedValue(
        await sessionFor(current, inOneDay()),
      );

      await service.logout(refreshToken);

      expect(repo.deleteSession).not.toHaveBeenCalled();
    });

    it('does nothing for an invalid token', async () => {
      await service.logout('garbage');

      expect(repo.findSessionById).not.toHaveBeenCalled();
    });
  });
});
