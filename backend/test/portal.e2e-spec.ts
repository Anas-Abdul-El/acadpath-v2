import { ConflictException, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { ProcessingStatus } from './../src/generated/prisma/enums.js';
import { DocumentsRepository } from './../src/me/documents/documents.repository.js';
import {
  PortalSessions,
  type PortalCapture,
  type PortalStatus,
} from './../src/portal/portal-sessions.service.js';
import { PortalTickets } from './../src/portal/portal-tickets.js';
import { StorageService } from './../src/storage/storage.service.js';
import { InMemoryDocumentsRepository } from './fakes/in-memory-documents.repository.js';
import { InMemoryStorage } from './fakes/in-memory-storage.js';
import { createTestApp, type TestApp } from './utils/create-test-app.js';

const jwt = new JwtService();
const tokenFor = (id: string, role: 'STUDENT' | 'ADMIN' = 'STUDENT') =>
  jwt.sign(
    { sub: id, role },
    {
      secret: process.env.ACCESS_TOKEN_SECRET ?? '',
      expiresIn: 600,
      algorithm: 'HS256',
    },
  );

const running = (over: Partial<PortalStatus> = {}): PortalStatus => ({
  running: true,
  url: 'https://syslbv4.liu.edu.lb/login/',
  title: 'Login',
  loggedIn: false,
  onTranscript: false,
  score: 0,
  threshold: 5,
  reasons: [],
  captured: null,
  ...over,
});

/** Stands in for PortalSessions: no browser. */
class FakeSessions {
  readonly started: string[] = [];
  readonly stopped: { userId: string; reason?: string }[] = [];
  capture: PortalCapture | null = null;

  start(userId: string) {
    this.started.push(userId);
    return Promise.resolve(running());
  }
  status(userId: string) {
    return this.started.includes(userId)
      ? running()
      : { ...running(), running: false, url: null, title: null };
  }
  stop(userId: string, reason?: string) {
    this.stopped.push({ userId, reason });
    return Promise.resolve();
  }
  getTranscript() {
    if (!this.capture) {
      return Promise.reject(
        new ConflictException('Open your transcript page in the portal first'),
      );
    }
    return Promise.resolve(this.capture);
  }
  addViewer() {
    return false;
  }
  onModuleDestroy() {
    return Promise.resolve();
  }
}

describe('Portal routes (e2e)', () => {
  let app: INestApplication<App>;
  let queues: TestApp['queues'];
  let sessions: FakeSessions;
  let documents: InMemoryDocumentsRepository;
  let storage: InMemoryStorage;

  beforeEach(async () => {
    sessions = new FakeSessions();
    documents = new InMemoryDocumentsRepository();
    documents.selections.set('u1', {
      studentId: 'sp-1',
      catalogStatus: ProcessingStatus.COMPLETED,
    });
    storage = new InMemoryStorage();
    ({ app, queues } = await createTestApp({
      overrides: [
        [PortalSessions, sessions],
        [DocumentsRepository, documents],
        [StorageService, storage],
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
      start: () => auth(request(server).post('/api/me/portal')),
      status: () => auth(request(server).get('/api/me/portal')),
      stop: () => auth(request(server).delete('/api/me/portal')),
      import: () => auth(request(server).post('/api/me/portal/transcript')),
    };
  };

  describe('POST /api/me/portal', () => {
    it('starts the browser and returns its status, a WebSocket ticket and the socket path', async () => {
      const res = await as('u1').start().expect(200);

      expect(res.body.data).toEqual({
        status: running(),
        ticket: expect.stringMatching(/^[0-9a-f-]{36}$/),
        socketPath: '/api/me/portal/ws',
      });
      expect(sessions.started).toEqual(['u1']);
      // The ticket belongs to this student, once.
      const tickets = app.get(PortalTickets);
      expect(tickets.redeem(res.body.data.ticket)).toBe('u1');
    });

    it('answers 422 before a university and major are selected', async () => {
      const res = await as('u2').start().expect(422);

      expect(res.body).toEqual({
        error: { message: 'Select your university first' },
      });
      expect(sessions.started).toEqual([]);
    });

    it('is limited to 40 starts per student per 15 minutes (v1: portalLimiter)', async () => {
      for (let i = 0; i < 40; i++) await as('u1').start().expect(200);

      await as('u1').start().expect(429);
    });

    it('is for students only', async () => {
      await as('a1', 'ADMIN').start().expect(403);
      await request(app.getHttpServer()).post('/api/me/portal').expect(401);
    });
  });

  it('GET /api/me/portal returns the status', async () => {
    await as('u1').start().expect(200);

    const res = await as('u1').status().expect(200);
    expect(res.body).toEqual({ data: running() });
  });

  it('DELETE /api/me/portal stops the browser (204)', async () => {
    await as('u1').stop().expect(204);

    expect(sessions.stopped).toEqual([{ userId: 'u1', reason: 'Stopped' }]);
  });

  describe('POST /api/me/portal/transcript', () => {
    const capture: PortalCapture = {
      url: 'https://syslbv4.liu.edu.lb/student/transcript',
      title: 'Unofficial Transcript',
      capturedAt: '2026-11-23T10:00:00.000Z',
      text: 'CSCI 250 | B+',
      file: {
        buffer: Buffer.from('<table><tr><td>CSCI 250</td></tr></table>'),
        mimeType: 'text/html',
      },
    };

    it('stores the page as a transcript document, queues it, closes the browser, and answers 202', async () => {
      sessions.capture = capture;

      const res = await as('u1').import().expect(202);

      expect(res.body.data).toEqual([
        expect.objectContaining({
          fileName: 'portal-transcript.html',
          type: 'TRANSCRIPT',
          mimeType: 'text/html',
          status: 'PENDING',
        }),
      ]);
      const [key] = [...storage.objects.keys()];
      expect(key).toMatch(/^documents\/sp-1\/[0-9a-f-]{36}\.html$/);
      expect(storage.objects.get(key)?.body.toString()).toContain('CSCI 250');
      expect(queues.transcripts.add).toHaveBeenCalledOnce();
      expect(sessions.stopped).toEqual([
        { userId: 'u1', reason: 'Transcript imported' },
      ]);
    });

    it('stores a transcript PDF as a PDF', async () => {
      sessions.capture = {
        ...capture,
        file: { buffer: Buffer.from('%PDF-1.4'), mimeType: 'application/pdf' },
      };

      const res = await as('u1').import().expect(202);
      expect(res.body.data[0]).toMatchObject({
        fileName: 'portal-transcript.pdf',
        mimeType: 'application/pdf',
      });
    });

    it('answers 409 while no transcript is on screen, and keeps the browser open', async () => {
      const res = await as('u1').import().expect(409);

      expect(res.body).toEqual({
        error: { message: 'Open your transcript page in the portal first' },
      });
      expect(sessions.stopped).toEqual([]);
    });

    it("answers 422 while the major's catalog isn't ready, and keeps the browser open", async () => {
      sessions.capture = capture;
      documents.selections.set('u1', {
        studentId: 'sp-1',
        catalogStatus: ProcessingStatus.PROCESSING,
      });

      await as('u1').import().expect(422);
      expect(sessions.stopped).toEqual([]);
      expect(storage.objects.size).toBe(0);
    });

    it('is limited to 30 imports per student per 15 minutes (v1: aiLimiter)', async () => {
      for (let i = 0; i < 30; i++) await as('u1').import().expect(409);

      await as('u1').import().expect(429);
    });
  });
});
