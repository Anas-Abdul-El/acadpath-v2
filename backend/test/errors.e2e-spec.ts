import { Test } from '@nestjs/testing';
import {
  ConflictException,
  Controller,
  Get,
  INestApplication,
  Post,
} from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { configureApp } from './../src/app.setup.js';

@Controller('errors-test')
class ErrorsTestController {
  @Get('conflict')
  conflict() {
    throw new ConflictException('Email is already registered');
  }

  @Get('bug')
  bug() {
    throw new Error('connection to db-internal:5432 refused');
  }

  @Post('echo')
  echo() {
    return { ok: true };
  }
}

// Every error response keeps v1's shape: { error: { message, details? } }.
describe('Error responses (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture = await Test.createTestingModule({
      controllers: [ErrorsTestController],
    }).compile();

    app = moduleFixture.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('sends the message of an HTTP exception thrown on purpose', () => {
    return request(app.getHttpServer())
      .get('/api/errors-test/conflict')
      .expect(409)
      .expect({ error: { message: 'Email is already registered' } });
  });

  it('hides the details of an unexpected error behind a generic 500', () => {
    return request(app.getHttpServer())
      .get('/api/errors-test/bug')
      .expect(500)
      .expect({ error: { message: 'Internal server error' } });
  });

  it('answers an unknown route with a 404 in the same shape', async () => {
    const res = await request(app.getHttpServer()).get('/api/nope').expect(404);

    expect(res.body).toEqual({ error: { message: 'Cannot GET /api/nope' } });
  });

  it('rejects malformed JSON with a 400 in the same shape', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/errors-test/echo')
      .set('Content-Type', 'application/json')
      .send('{"email": ')
      .expect(400);

    expect(res.body).toEqual({ error: { message: expect.any(String) } });
  });

  it('serves every route under the /api prefix, like v1', () => {
    return request(app.getHttpServer()).post('/errors-test/echo').expect(404);
  });
});
