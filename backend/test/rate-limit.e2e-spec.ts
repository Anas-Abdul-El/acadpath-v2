import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { configureApp } from './../src/app.setup.js';
import { AuthRepository } from './../src/auth/auth.repository.js';
import { InMemoryAuthRepository } from './fakes/in-memory-auth.repository.js';

// Each test builds a new app, and the throttler's in-memory counters live in the app,
// so every test starts from zero.
describe('Rate limiting (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AuthRepository)
      .useValue(new InMemoryAuthRepository())
      .compile();

    app = moduleFixture.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
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
});
