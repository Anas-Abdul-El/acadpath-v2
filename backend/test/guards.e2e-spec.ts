import { Test } from '@nestjs/testing';
import { Controller, Get, INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { configureApp } from './../src/app.setup.js';
import type { AuthUser } from './../src/auth/auth.types.js';
import { CurrentUser } from './../src/auth/decorators/current-user.decorator.js';
import { Public } from './../src/auth/decorators/public.decorator.js';
import { Roles } from './../src/auth/decorators/roles.decorator.js';
import { UserRole } from './../src/generated/prisma/enums.js';

const ACCESS_SECRET = process.env.ACCESS_TOKEN_SECRET ?? '';
const REFRESH_SECRET = process.env.REFRESH_TOKEN_SECRET ?? '';
const jwt = new JwtService();

const accessToken = (payload: object, secret = ACCESS_SECRET) =>
  jwt.sign(payload, { secret, expiresIn: 60, algorithm: 'HS256' });

@Controller('guards-test')
class GuardsTestController {
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return user;
  }

  @Get('admin')
  @Roles(UserRole.ADMIN)
  admin() {
    return { ok: true };
  }

  @Get('public')
  @Public()
  open() {
    return { ok: true };
  }
}

// The guards are global (APP_GUARD), so every route is protected unless it says @Public().
describe('Access-token and role guards (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [GuardsTestController],
    }).compile();

    app = moduleFixture.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const get = (path: string, token?: string) => {
    const req = request(app.getHttpServer()).get(`/api/guards-test/${path}`);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  describe('access-token guard (v1: authenticate)', () => {
    it('puts the user from a valid access token on the request', async () => {
      const token = accessToken({ sub: 'user-1', role: 'STUDENT' });

      const res = await get('me', token).expect(200);
      expect(res.body).toEqual({ id: 'user-1', role: 'STUDENT' });
    });

    it('answers 401 when the Authorization header is missing', async () => {
      const res = await get('me').expect(401);
      expect(res.body).toEqual({
        error: { message: 'Missing or malformed access token' },
      });
    });

    it('answers 401 for a non-Bearer Authorization header', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/guards-test/me')
        .set('Authorization', 'Basic dXNlcjpwdw==')
        .expect(401);
      expect(res.body.error.message).toBe('Missing or malformed access token');
    });

    it.each([
      ['a garbage token', 'not-a-jwt'],
      [
        'a refresh token',
        accessToken({ sub: 'user-1', role: 'STUDENT' }, REFRESH_SECRET),
      ],
      [
        'an expired token',
        jwt.sign(
          {
            sub: 'user-1',
            role: 'STUDENT',
            exp: Math.floor(Date.now() / 1000) - 10,
          },
          { secret: ACCESS_SECRET },
        ),
      ],
      ['a token without a role', accessToken({ sub: 'user-1' })],
      [
        'a token with an unknown role',
        accessToken({ sub: 'user-1', role: 'SUPERUSER' }),
      ],
      ['a token without a subject', accessToken({ role: 'STUDENT' })],
    ])('answers 401 for %s', async (_case, token) => {
      const res = await get('me', token).expect(401);
      expect(res.body).toEqual({
        error: { message: 'Invalid or expired token' },
      });
    });

    it('lets @Public() routes through without a token', async () => {
      await get('public').expect(200);
    });
  });

  describe('role guard (v1: authorize)', () => {
    it('answers 403 when the role is not allowed', async () => {
      const token = accessToken({ sub: 'user-1', role: 'STUDENT' });

      const res = await get('admin', token).expect(403);
      expect(res.body).toEqual({
        error: { message: "You don't have permission to do this" },
      });
    });

    it('lets an allowed role through', async () => {
      const token = accessToken({ sub: 'admin-1', role: 'ADMIN' });

      await get('admin', token).expect(200);
    });

    it('checks the token before the role: no token is 401, not 403', async () => {
      await get('admin').expect(401);
    });
  });
});
