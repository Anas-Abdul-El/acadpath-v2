import { INestApplication } from '@nestjs/common';
import { Controller, Get } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AuthRepository } from './../src/auth/auth.repository.js';
import { InMemoryAuthRepository } from './fakes/in-memory-auth.repository.js';
import { createTestApp } from './utils/create-test-app.js';
import { Polled } from './../src/common/decorators/polled.decorator.js';

@Controller('poll-test')
class PollTestController {
  @Get('polled')
  @Polled()
  polled() {
    return { ok: true };
  }

  @Get('normal')
  normal() {
    return { ok: true };
  }
}

const jwt = new JwtService();
const tokenFor = (id: string) =>
  jwt.sign(
    { sub: id, role: 'STUDENT' },
    {
      secret: process.env.ACCESS_TOKEN_SECRET ?? '',
      expiresIn: 600,
      algorithm: 'HS256',
    },
  );

// Each test builds a new app, and the throttler's in-memory counters live in the app,
// so every test starts from zero.
describe('Rate limiting (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    ({ app } = await createTestApp({
      overrides: [[AuthRepository, new InMemoryAuthRepository()]],
      controllers: [PollTestController],
    }));
  });

  afterEach(async () => {
    await app.close();
  });

  const badLogin = () =>
    request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'nobody@liu.edu.lb', password: 'wrong-password1' });

  it('allows 10 login attempts per 15 minutes per IP, then answers 429', async () => {
    for (let i = 0; i < 10; i++) await badLogin().expect(401);

    const res = await badLogin().expect(429);
    expect(res.body).toEqual({
      error: { message: 'Too many requests, try again later' },
    });
    expect(res.get('Retry-After')).toBeDefined();
  });

  it('counts sign-up attempts against the same strict limit', async () => {
    const signUp = () =>
      request(app.getHttpServer())
        .post('/api/auth/signin')
        .send({ email: 'bad', password: 'x', name: 'x' });

    for (let i = 0; i < 10; i++) await signUp().expect(400);
    await signUp().expect(429);
  });

  it('gives other routes the looser global limit of 100 per 15 minutes', async () => {
    // refresh has no @Throttle override, so only the global limit applies.
    for (let i = 0; i < 11; i++) {
      await request(app.getHttpServer()).post('/api/auth/refresh').expect(401);
    }
  });

  describe('polled routes (v1: pollLimiter)', () => {
    const get = (path: string, userId: string) =>
      request(app.getHttpServer())
        .get(`/api/poll-test/${path}`)
        .set('Authorization', `Bearer ${tokenFor(userId)}`);

    it('skip the global limit and allow 600 requests per user per 15 minutes', async () => {
      for (let i = 0; i < 600; i++) await get('polled', 'user-a').expect(200);

      const res = await get('polled', 'user-a').expect(429);
      expect(res.body).toEqual({
        error: { message: 'Too many requests, try again later' },
      });
    });

    it('count per user, not per IP: another user is not affected', async () => {
      for (let i = 0; i < 600; i++) await get('polled', 'user-a').expect(200);

      await get('polled', 'user-b').expect(200);
    });

    it('leave the global limit in place on routes that are not polled', async () => {
      for (let i = 0; i < 100; i++) await get('normal', 'user-a').expect(200);

      await get('normal', 'user-a').expect(429);
    });
  });
});
