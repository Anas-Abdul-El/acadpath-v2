import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { ProcessingStatus } from './../src/generated/prisma/enums.js';
import { DocumentsRepository } from './../src/me/documents/documents.repository.js';
import { StorageService } from './../src/storage/storage.service.js';
import { InMemoryDocumentsRepository } from './fakes/in-memory-documents.repository.js';
import { InMemoryStorage } from './fakes/in-memory-storage.js';
import { fileBytes } from './fixtures/files.js';
import { createTestApp, type TestApp } from './utils/create-test-app.js';

const jwt = new JwtService();
const tokenFor = (id: string, role: 'STUDENT' | 'ADMIN' = 'STUDENT') =>
  jwt.sign(
    { sub: id, role },
    {
      secret: process.env.ACCESS_TOKEN_SECRET ?? '',
      expiresIn: 60,
      algorithm: 'HS256',
    },
  );

describe('Document routes (e2e)', () => {
  let app: INestApplication<App>;
  let queues: TestApp['queues'];
  let repo: InMemoryDocumentsRepository;
  let storage: InMemoryStorage;

  beforeEach(async () => {
    repo = new InMemoryDocumentsRepository();
    repo.selections.set('u1', {
      studentId: 'sp-1',
      catalogStatus: ProcessingStatus.COMPLETED,
    });
    repo.selections.set('u2', {
      studentId: 'sp-2',
      catalogStatus: ProcessingStatus.COMPLETED,
    });
    storage = new InMemoryStorage();
    ({ app, queues } = await createTestApp({
      overrides: [
        [DocumentsRepository, repo],
        [StorageService, storage],
      ],
    }));
  });

  afterEach(async () => {
    await app.close();
  });

  const upload = (userId: string, role: 'STUDENT' | 'ADMIN' = 'STUDENT') =>
    request(app.getHttpServer())
      .post('/api/me/documents')
      .set('Authorization', `Bearer ${tokenFor(userId, role)}`);
  const list = (userId: string, query = '') =>
    request(app.getHttpServer())
      .get(`/api/me/documents${query}`)
      .set('Authorization', `Bearer ${tokenFor(userId)}`);

  describe('POST /api/me/documents', () => {
    it('stores the files, answers 202 with PENDING documents, and queues the extraction', async () => {
      const res = await upload('u1')
        .attach('files', fileBytes.pdf(), {
          filename: 'transcript.pdf',
          contentType: 'application/pdf',
        })
        .attach('files', fileBytes.png(), {
          filename: 'page2.png',
          contentType: 'image/png',
        })
        .expect(202);

      expect(res.body.data).toEqual([
        expect.objectContaining({
          fileName: 'transcript.pdf',
          type: 'TRANSCRIPT',
          status: 'PENDING',
          mimeType: 'application/pdf',
        }),
        expect.objectContaining({
          fileName: 'page2.png',
          type: 'TRANSCRIPT',
          status: 'PENDING',
          mimeType: 'image/png',
        }),
      ]);
      // The storage key is internal: never sent to the client.
      expect(res.body.data[0]).not.toHaveProperty('fileUrl');
      expect(storage.objects.size).toBe(2);
      expect(queues.transcripts.add).toHaveBeenCalledWith(
        'extract',
        {
          studentId: 'sp-1',
          documentIds: res.body.data.map((d: { id: string }) => d.id),
        },
        expect.objectContaining({ attempts: 3 }),
      );
    });

    it('accepts another document type', async () => {
      const res = await upload('u1')
        .field('type', 'DEGREE_AUDIT')
        .attach('files', fileBytes.pdf(), {
          filename: 'audit.pdf',
          contentType: 'application/pdf',
        })
        .expect(202);

      expect(res.body.data[0].type).toBe('DEGREE_AUDIT');
    });

    it('rejects an unknown document type', async () => {
      const res = await upload('u1')
        .field('type', 'DIPLOMA')
        .attach('files', fileBytes.pdf(), {
          filename: 'a.pdf',
          contentType: 'application/pdf',
        })
        .expect(400);

      expect(res.body.error.details).toEqual([
        { path: 'type', message: 'Select a valid document type' },
      ]);
    });

    it('answers 415 for a file that is not really a PDF or image', async () => {
      await upload('u1')
        .attach('files', fileBytes.exe(), {
          filename: 'transcript.pdf',
          contentType: 'application/pdf',
        })
        .expect(415);
      expect(storage.objects.size).toBe(0);
    });

    it("answers 422 while the major's catalog isn't ready", async () => {
      repo.selections.set('u1', {
        studentId: 'sp-1',
        catalogStatus: ProcessingStatus.PROCESSING,
      });

      const res = await upload('u1')
        .attach('files', fileBytes.pdf(), {
          filename: 'a.pdf',
          contentType: 'application/pdf',
        })
        .expect(422);
      expect(res.body).toEqual({
        error: { message: "Your university's course catalog isn't ready yet" },
      });
    });

    it('answers 503 when storage is down, and stores nothing', async () => {
      storage.failPuts = true;

      await upload('u1')
        .attach('files', fileBytes.pdf(), {
          filename: 'a.pdf',
          contentType: 'application/pdf',
        })
        .expect(503);
      expect(queues.transcripts.add).not.toHaveBeenCalled();
    });

    it('needs a token, and is for students only', async () => {
      await request(app.getHttpServer()).post('/api/me/documents').expect(401);
      await upload('u1', 'ADMIN')
        .attach('files', fileBytes.pdf(), {
          filename: 'a.pdf',
          contentType: 'application/pdf',
        })
        .expect(403);
    });

    it('checks the token before reading the upload: no file is stored for a bad token', async () => {
      await request(app.getHttpServer())
        .post('/api/me/documents')
        .set('Authorization', 'Bearer not-a-token')
        .attach('files', fileBytes.pdf(), {
          filename: 'a.pdf',
          contentType: 'application/pdf',
        })
        .expect(401);
      expect(storage.objects.size).toBe(0);
    });
  });

  describe('GET /api/me/documents', () => {
    beforeEach(async () => {
      await upload('u1')
        .attach('files', fileBytes.pdf(), {
          filename: 'mine.pdf',
          contentType: 'application/pdf',
        })
        .expect(202);
      await upload('u1')
        .field('type', 'OTHER')
        .attach('files', fileBytes.pdf(), {
          filename: 'other.pdf',
          contentType: 'application/pdf',
        })
        .expect(202);
      await upload('u2')
        .attach('files', fileBytes.pdf(), {
          filename: 'theirs.pdf',
          contentType: 'application/pdf',
        })
        .expect(202);
    });

    it("lists only the logged-in student's documents, newest first", async () => {
      const res = await list('u1').expect(200);

      expect(
        res.body.data.map((d: { fileName: string }) => d.fileName),
      ).toEqual(['other.pdf', 'mine.pdf']);
    });

    it('filters by type', async () => {
      const res = await list('u1', '?type=TRANSCRIPT').expect(200);

      expect(
        res.body.data.map((d: { fileName: string }) => d.fileName),
      ).toEqual(['mine.pdf']);
    });

    it('rejects an unknown type filter', async () => {
      const res = await list('u1', '?type=NOPE').expect(400);

      expect(res.body.error.details).toEqual([
        { path: 'type', message: 'Select a valid document type' },
      ]);
    });
  });
});
