import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AuthRepository } from './../src/auth/auth.repository.js';
import { InMemoryAuthRepository } from './fakes/in-memory-auth.repository.js';
import { createTestApp } from './utils/create-test-app.js';

const ACCESS_SECRET = process.env.ACCESS_TOKEN_SECRET ?? '';
const REFRESH_SECRET = process.env.REFRESH_TOKEN_SECRET ?? '';

const student = {
  email: 'student@liu.edu.lb',
  password: 'password123',
  name: 'Sara Haddad',
};

/** Returns the `refreshToken=...` pair from a response's Set-Cookie header. */
function refreshCookieOf(res: request.Response): string {
  const header = res.get('Set-Cookie') ?? [];
  const cookie = header.find((c) => c.startsWith('refreshToken='));
  if (!cookie) throw new Error('No refreshToken cookie was set');
  return cookie.split(';')[0];
}

function setCookieHeader(res: request.Response): string {
  return (res.get('Set-Cookie') ?? []).join('\n');
}

describe('Auth routes (e2e)', () => {
  let app: INestApplication<App>;
  let repo: InMemoryAuthRepository;
  const jwt = new JwtService();

  beforeEach(async () => {
    repo = new InMemoryAuthRepository();
    ({ app } = await createTestApp({ overrides: [[AuthRepository, repo]] }));
  });

  afterEach(async () => {
    await app.close();
  });

  const signUp = (body: object = student) =>
    request(app.getHttpServer()).post('/api/auth/signin').send(body);
  const logIn = (body: object) =>
    request(app.getHttpServer()).post('/api/auth/login').send(body);
  const refresh = (cookie?: string) => {
    const req = request(app.getHttpServer()).post('/api/auth/refresh');
    return cookie ? req.set('Cookie', cookie) : req;
  };

  describe('POST /api/auth/signin (create an account)', () => {
    it('creates a student account and returns the user and an access token', async () => {
      const res = await signUp().expect(201);

      expect(res.body).toEqual({
        data: {
          user: {
            id: expect.any(String),
            name: 'Sara Haddad',
            email: 'student@liu.edu.lb',
            role: 'STUDENT',
          },
          accessToken: expect.any(String),
        },
      });
    });

    it('sets the refresh token in an httpOnly, strict, /api/auth-scoped cookie for 7 days', async () => {
      const res = await signUp().expect(201);
      const cookie = (res.get('Set-Cookie') ?? []).find((c) =>
        c.startsWith('refreshToken='),
      );

      expect(cookie).toBeDefined();
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Strict');
      expect(cookie).toContain('Path=/api/auth');
      expect(cookie).toContain(`Max-Age=${7 * 24 * 60 * 60}`);
      // The refresh token never appears in the JSON body.
      expect(JSON.stringify(res.body)).not.toContain(
        refreshCookieOf(res).slice('refreshToken='.length),
      );
    });

    it('stores a bcrypt hash, never the plain password', async () => {
      await signUp().expect(201);

      const [stored] = [...repo.users.values()];
      expect(stored.passwordHash).not.toBe(student.password);
      await expect(
        bcrypt.compare(student.password, stored.passwordHash),
      ).resolves.toBe(true);
    });

    it('trims and lowercases the email', async () => {
      const res = await signUp({
        ...student,
        email: '  Student@LIU.edu.lb ',
      }).expect(201);

      expect(res.body.data.user.email).toBe('student@liu.edu.lb');
    });

    it('issues an access token carrying the user id and role, signed with the access secret', async () => {
      const res = await signUp().expect(201);

      const payload = jwt.verify<{ sub: string; role: string }>(
        res.body.data.accessToken,
        { secret: ACCESS_SECRET, algorithms: ['HS256'] },
      );
      expect(payload.sub).toBe(res.body.data.user.id);
      expect(payload.role).toBe('STUDENT');
    });

    it('refuses a role sent by the client: every new account is a student', async () => {
      const res = await signUp({ ...student, role: 'ADMIN' }).expect(400);

      expect(res.body.error.details).toEqual([
        { path: 'role', message: 'property role should not exist' },
      ]);
      expect(repo.users.size).toBe(0);
    });

    it('answers 409 when the email is already registered, in any letter case', async () => {
      await signUp().expect(201);

      const res = await signUp({
        ...student,
        email: 'STUDENT@liu.edu.lb',
      }).expect(409);
      expect(res.body).toEqual({
        error: { message: 'Email is already registered' },
      });
    });

    it.each([
      [
        'a missing email',
        { password: student.password, name: student.name },
        'email',
        'Email is required',
      ],
      [
        'an invalid email',
        { ...student, email: 'not-an-email' },
        'email',
        'Invalid Email',
      ],
      [
        'a password without a number',
        { ...student, password: 'passwordonly' },
        'password',
        'Password must be at least 8 characters and contain a number',
      ],
      [
        'a password shorter than 8 characters',
        { ...student, password: 'pass1' },
        'password',
        'Password must be at least 8 characters and contain a number',
      ],
      [
        'a password over 72 bytes (bcrypt ignores the rest)',
        { ...student, password: `1${'é'.repeat(36)}` },
        'password',
        'Password is too long',
      ],
      ['a blank name', { ...student, name: '   ' }, 'name', 'Name is required'],
    ])('rejects %s', async (_case, body, path, message) => {
      const res = await signUp(body).expect(400);

      expect(res.body).toEqual({
        error: { message: 'Validation failed', details: [{ path, message }] },
      });
    });
  });

  describe('POST /api/auth/login', () => {
    beforeEach(async () => {
      await signUp().expect(201);
    });

    it('logs in with the right password and sets a refresh cookie', async () => {
      const res = await logIn({
        email: student.email,
        password: student.password,
      }).expect(200);

      expect(res.body).toEqual({
        data: {
          user: {
            id: expect.any(String),
            name: student.name,
            email: student.email,
            role: 'STUDENT',
          },
          accessToken: expect.any(String),
        },
      });
      expect(refreshCookieOf(res)).toMatch(/^refreshToken=.+/);
    });

    it('matches the email whatever its letter case', async () => {
      await logIn({
        email: 'STUDENT@liu.edu.lb',
        password: student.password,
      }).expect(200);
    });

    it('starts a new session on every login', async () => {
      await logIn({ email: student.email, password: student.password });

      // One from sign-up, one from this login.
      expect(repo.sessions.size).toBe(2);
    });

    it('answers the same 401 for a wrong password and an unknown email', async () => {
      const wrongPassword = await logIn({
        email: student.email,
        password: 'wrong-password1',
      }).expect(401);
      const unknownEmail = await logIn({
        email: 'nobody@liu.edu.lb',
        password: student.password,
      }).expect(401);

      const expected = { error: { message: 'Invalid email or password' } };
      expect(wrongPassword.body).toEqual(expected);
      expect(unknownEmail.body).toEqual(expected);
      expect(setCookieHeader(wrongPassword)).not.toContain('refreshToken=');
    });

    it('only checks that a password is present, so a weak one is a 401, not a 400', async () => {
      await logIn({ email: student.email, password: 'x' }).expect(401);
    });

    it('rejects a missing password', async () => {
      const res = await logIn({ email: student.email }).expect(400);

      expect(res.body.error.details).toEqual([
        { path: 'password', message: 'Password is required' },
      ]);
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('returns a new access token and rotates the refresh cookie', async () => {
      const signup = await signUp().expect(201);
      const oldCookie = refreshCookieOf(signup);

      const res = await refresh(oldCookie).expect(200);

      expect(res.body).toEqual({ data: { accessToken: expect.any(String) } });
      const newCookie = refreshCookieOf(res);
      expect(newCookie).not.toBe(oldCookie);
      expect(setCookieHeader(res)).toContain('Path=/api/auth');
    });

    it('accepts the rotated token on the next refresh', async () => {
      const signup = await signUp().expect(201);
      const second = await refresh(refreshCookieOf(signup)).expect(200);

      await refresh(refreshCookieOf(second)).expect(200);
    });

    it('treats a reused (already rotated) token as theft and ends the session', async () => {
      const signup = await signUp().expect(201);
      const stolen = refreshCookieOf(signup);
      const rotated = await refresh(stolen).expect(200);

      const replay = await refresh(stolen).expect(401);
      expect(replay.body).toEqual({
        error: { message: 'Invalid or expired token' },
      });
      // The session is gone, so the legitimate holder's newer token stops working too.
      expect(repo.sessions.size).toBe(0);
      await refresh(refreshCookieOf(rotated)).expect(401);
    });

    it('answers 401 with validation details when the cookie is missing', async () => {
      const res = await refresh().expect(401);

      expect(res.body).toEqual({
        error: {
          message: 'Validation failed',
          details: [
            {
              path: 'refreshToken',
              message: 'Invalid or missing refresh token',
            },
          ],
        },
      });
    });

    it('answers 401 when the cookie is not a JWT', async () => {
      await refresh('refreshToken=not-a-jwt').expect(401);
    });

    it('refuses an access token used as a refresh token', async () => {
      const signup = await signUp().expect(201);

      const res = await refresh(
        `refreshToken=${signup.body.data.accessToken}`,
      ).expect(401);
      expect(res.body).toEqual({
        error: { message: 'Invalid or expired token' },
      });
    });

    it('refuses a token signed with another secret', async () => {
      const forged = jwt.sign(
        { sub: 'someone', role: 'ADMIN', sid: 'any-session' },
        { secret: 'x'.repeat(40), algorithm: 'HS256' },
      );

      await refresh(`refreshToken=${forged}`).expect(401);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('ends the session and clears the cookie', async () => {
      const signup = await signUp().expect(201);
      const cookie = refreshCookieOf(signup);

      const res = await request(app.getHttpServer())
        .post('/api/auth/logout')
        .set('Cookie', cookie)
        .expect(204);

      expect(setCookieHeader(res)).toMatch(
        /refreshToken=;.*Path=\/api\/auth.*Expires=Thu, 01 Jan 1970/,
      );
      expect(repo.sessions.size).toBe(0);
      await refresh(cookie).expect(401);
    });

    it('succeeds without a cookie (logging out twice is fine)', async () => {
      await request(app.getHttpServer()).post('/api/auth/logout').expect(204);
    });

    it('ignores an invalid token without failing', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/logout')
        .set('Cookie', 'refreshToken=garbage')
        .expect(204);
    });
  });

  it('keeps access and refresh secrets distinct (sanity check on test env)', () => {
    expect(ACCESS_SECRET).not.toBe(REFRESH_SECRET);
  });
});
