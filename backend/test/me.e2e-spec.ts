import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { configureApp } from './../src/app.setup.js';
import { MeRepository } from './../src/me/me.repository.js';
import { YearOfStudy } from './../src/generated/prisma/enums.js';
import { admin, computerScience, liu, student } from './fakes/me-fixtures.js';
import { InMemoryMeRepository } from './fakes/in-memory-me.repository.js';

const jwt = new JwtService();
const tokenFor = (id: string, role: 'STUDENT' | 'ADMIN') =>
  jwt.sign(
    { sub: id, role },
    {
      secret: process.env.ACCESS_TOKEN_SECRET ?? '',
      expiresIn: 60,
      algorithm: 'HS256',
    },
  );

describe('Me routes (e2e)', () => {
  let app: INestApplication<App>;
  let repo: InMemoryMeRepository;

  beforeEach(async () => {
    repo = new InMemoryMeRepository();
    repo.add(student('s1'));
    repo.add(student('s2', { yearOfStudy: YearOfStudy.YEAR_3 }));
    repo.add(admin('a1'));

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MeRepository)
      .useValue(repo)
      .compile();

    app = moduleFixture.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const as = (id: string, role: 'STUDENT' | 'ADMIN' = 'STUDENT') => {
    const server = app.getHttpServer();
    const auth = (req: request.Test) =>
      req.set('Authorization', `Bearer ${tokenFor(id, role)}`);
    return {
      get: (path: string) => auth(request(server).get(`/api/me${path}`)),
      put: (path: string) => auth(request(server).put(`/api/me${path}`)),
      patch: (path: string) => auth(request(server).patch(`/api/me${path}`)),
      post: (path: string) => auth(request(server).post(`/api/me${path}`)),
    };
  };

  describe('authentication and roles', () => {
    it.each([
      ['GET', '/'],
      ['PUT', '/year-of-study'],
      ['PATCH', '/profile'],
      ['POST', '/onboarding/complete'],
    ])('%s /api/me%s needs an access token', async (method, path) => {
      await request(app.getHttpServer())
        [method.toLowerCase() as 'get' | 'put' | 'patch' | 'post'](
          `/api/me${path === '/' ? '' : path}`,
        )
        .expect(401);
    });

    it.each([
      ['put', '/year-of-study'],
      ['patch', '/profile'],
      ['post', '/onboarding/complete'],
    ] as const)(
      'an admin gets 403 on the student-only %s %s',
      async (method, path) => {
        await as('a1', 'ADMIN')
          [method](path)
          .send({ yearOfStudy: 'YEAR_1' })
          .expect(403);
      },
    );
  });

  describe('GET /api/me', () => {
    it('returns the logged-in student, profile and onboarding state', async () => {
      const res = await as('s2').get('').expect(200);

      expect(res.body).toEqual({
        data: {
          user: {
            id: 's2',
            name: 'Sara Haddad',
            email: 's2@liu.edu.lb',
            role: 'STUDENT',
          },
          profile: {
            university: null,
            major: null,
            yearOfStudy: 'YEAR_3',
            onboardingCompletedAt: null,
          },
          onboarding: {
            universitySelected: false,
            catalogStatus: null,
            universityDocumentsUploaded: false,
            yearOfStudySelected: true,
            transcriptRequired: true,
            transcriptUploaded: false,
            completed: false,
          },
        },
      });
    });

    it('is open to admins too, with no profile', async () => {
      const res = await as('a1', 'ADMIN').get('').expect(200);

      expect(res.body.data).toMatchObject({ profile: null, onboarding: null });
    });

    it('answers 401 when the token belongs to a deleted user', async () => {
      const res = await as('ghost').get('').expect(401);
      expect(res.body).toEqual({ error: { message: 'User not found' } });
    });
  });

  describe('PUT /api/me/year-of-study', () => {
    it('saves the year for the logged-in student only', async () => {
      const res = await as('s1')
        .put('/year-of-study')
        .send({ yearOfStudy: 'NEW_STUDENT' })
        .expect(200);

      expect(res.body).toEqual({
        data: { yearOfStudy: 'NEW_STUDENT', transcriptRequired: false },
      });
      expect(repo.users.get('s1')?.studentProfile?.yearOfStudy).toBe(
        'NEW_STUDENT',
      );
      // Another student's record is untouched.
      expect(repo.users.get('s2')?.studentProfile?.yearOfStudy).toBe('YEAR_3');
    });

    it.each([
      ['an unknown value', { yearOfStudy: 'YEAR_9' }],
      ['a missing value', {}],
      ['null', { yearOfStudy: null }],
    ])('rejects %s', async (_case, body) => {
      const res = await as('s1').put('/year-of-study').send(body).expect(400);

      expect(res.body.error.details).toEqual([
        { path: 'yearOfStudy', message: 'Select a valid year of study' },
      ]);
    });

    it('cannot target another student: a userId in the body is refused', async () => {
      await as('s1')
        .put('/year-of-study')
        .send({ yearOfStudy: 'YEAR_1', userId: 's2' })
        .expect(400);
      expect(repo.users.get('s2')?.studentProfile?.yearOfStudy).toBe('YEAR_3');
    });
  });

  describe('PATCH /api/me/profile', () => {
    it('updates the profile and returns the full /me data', async () => {
      const res = await as('s1')
        .patch('/profile')
        .send({ yearOfStudy: 'YEAR_4' })
        .expect(200);

      expect(res.body.data.profile.yearOfStudy).toBe('YEAR_4');
      expect(res.body.data.onboarding.yearOfStudySelected).toBe(true);
    });

    it('rejects an empty body', async () => {
      const res = await as('s1').patch('/profile').send({}).expect(400);

      expect(res.body).toEqual({
        error: {
          message: 'Validation failed',
          details: [{ path: '', message: 'Send at least one field to update' }],
        },
      });
    });

    it('rejects null, which would otherwise clear the field', async () => {
      const res = await as('s1')
        .patch('/profile')
        .send({ yearOfStudy: null })
        .expect(400);

      expect(res.body.error.details).toEqual([
        { path: 'yearOfStudy', message: 'Select a valid year of study' },
      ]);
    });

    it('rejects unknown fields', async () => {
      await as('s1').patch('/profile').send({ role: 'ADMIN' }).expect(400);
    });
  });

  describe('POST /api/me/onboarding/complete', () => {
    it('answers 422 with the first missing step', async () => {
      const res = await as('s1').post('/onboarding/complete').expect(422);

      expect(res.body).toEqual({
        error: { message: 'Select your university and major first' },
      });
    });

    it('completes onboarding when every step is done', async () => {
      repo.add(
        student('s3', {
          university: liu(),
          major: computerScience(),
          yearOfStudy: YearOfStudy.NEW_STUDENT,
        }),
      );

      const res = await as('s3').post('/onboarding/complete').expect(200);

      expect(res.body.data.onboarding.completed).toBe(true);
      expect(res.body.data.profile.onboardingCompletedAt).toEqual(
        expect.any(String),
      );
    });
  });
});
