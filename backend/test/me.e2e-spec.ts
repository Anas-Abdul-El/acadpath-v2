import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { MeRepository } from './../src/me/me.repository.js';
import { UniversityRepository } from './../src/me/university/university.repository.js';
import { YearOfStudy } from './../src/generated/prisma/enums.js';
import { admin, computerScience, liu, student } from './fakes/me-fixtures.js';
import { InMemoryMeRepository } from './fakes/in-memory-me.repository.js';
import { InMemoryUniversityRepository } from './fakes/in-memory-university.repository.js';
import { createTestApp, type TestApp } from './utils/create-test-app.js';

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
  let universities: InMemoryUniversityRepository;
  let catalogQueue: TestApp['catalogQueue'];

  beforeEach(async () => {
    repo = new InMemoryMeRepository();
    repo.add(student('s1'));
    repo.add(student('s2', { yearOfStudy: YearOfStudy.YEAR_3 }));
    repo.add(admin('a1'));

    universities = new InMemoryUniversityRepository();
    ({ app, catalogQueue } = await createTestApp({
      overrides: [
        [MeRepository, repo],
        [UniversityRepository, universities],
      ],
    }));
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
      ['PUT', '/university'],
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
      ['put', '/university'],
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
            catalogError: null,
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

  describe('PUT /api/me/university', () => {
    const body = {
      name: 'Lebanese International University',
      country: 'Lebanon',
      city: 'Beirut',
      major: 'Computer Science',
    };

    it('saves a new university and major, queues the catalog extraction, and answers at once', async () => {
      const res = await as('s1').put('/university').send(body).expect(200);

      expect(res.body.data).toMatchObject({
        university: {
          name: 'Lebanese International University',
          country: 'Lebanon',
          city: 'Beirut',
        },
        major: { name: 'Computer Science', degreeType: 'BACHELOR' },
        catalog: { status: 'PROCESSING', error: null },
        replaced: false,
      });
      // Internal fields stay internal.
      expect(res.body.data.major).not.toHaveProperty('catalogStatus');

      const majorId: string = res.body.data.major.id;
      expect(universities.selections.get('s1')).toEqual({
        universityId: res.body.data.university.id,
        majorId,
      });
      expect(catalogQueue.add).toHaveBeenCalledOnce();
      expect(catalogQueue.add).toHaveBeenCalledWith(
        'extract',
        expect.objectContaining({ majorId, majorName: 'Computer Science' }),
        expect.objectContaining({ jobId: majorId, attempts: 3 }),
      );
    });

    it('reuses an extracted major: no new job, catalog AVAILABLE', async () => {
      await as('s1').put('/university').send(body).expect(200);
      const [major] = [...universities.majors.values()];
      major.catalogStatus = 'COMPLETED';
      catalogQueue.add.mockClear();

      const res = await as('s2')
        .put('/university')
        .send({
          ...body,
          name: ' lebanese  INTERNATIONAL university',
          major: 'computer science',
        })
        .expect(200);

      expect(res.body.data.catalog.status).toBe('AVAILABLE');
      expect(res.body.data.major.id).toBe(major.id);
      expect(catalogQueue.add).not.toHaveBeenCalled();
    });

    it('answers 503 when the queue is down, instead of a vague 500', async () => {
      catalogQueue.add.mockRejectedValue(new Error('ECONNREFUSED'));

      const res = await as('s1').put('/university').send(body).expect(503);
      expect(res.body).toEqual({
        error: {
          message: 'Catalog extraction is unavailable, try again later',
        },
      });
    });

    it.each([
      [
        'a missing name',
        { ...body, name: undefined },
        'name',
        'University name is required',
      ],
      [
        'a blank name',
        { ...body, name: '   ' },
        'name',
        'University name is required',
      ],
      [
        'a short name',
        { ...body, name: 'LI' },
        'name',
        "Enter your university's full name",
      ],
      [
        'a long name',
        { ...body, name: 'x'.repeat(121) },
        'name',
        'Use 120 characters or fewer',
      ],
      [
        'a missing country',
        { ...body, country: undefined },
        'country',
        'Country is required',
      ],
      [
        'a one-letter country',
        { ...body, country: 'L' },
        'country',
        'Enter the full country name',
      ],
      [
        'a country with digits',
        { ...body, country: 'Lebanon1' },
        'country',
        'Use letters only',
      ],
      ['a blank city', { ...body, city: '' }, 'city', 'City is required'],
      [
        'a city with symbols',
        { ...body, city: 'Beirut#' },
        'city',
        'Use letters only',
      ],
      [
        'a missing major',
        { ...body, major: undefined },
        'major',
        'Major is required',
      ],
      [
        'a one-letter major',
        { ...body, major: 'C' },
        'major',
        "Enter your major's full name",
      ],
      [
        'a long major',
        { ...body, major: 'x'.repeat(101) },
        'major',
        'Use 100 characters or fewer',
      ],
    ])('rejects %s', async (_case, payload, path, message) => {
      const res = await as('s1').put('/university').send(payload).expect(400);

      expect(res.body.error.details).toEqual([{ path, message }]);
      expect(catalogQueue.add).not.toHaveBeenCalled();
    });

    it('accepts accented and punctuated place names', async () => {
      await as('s1')
        .put('/university')
        .send({ ...body, country: "Côte d'Ivoire", city: 'Saint-Louis (Nord)' })
        .expect(200);
    });
  });
});
