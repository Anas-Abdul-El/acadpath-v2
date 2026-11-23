import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/env.validation.js';
import { PortalNetworkPolicy } from './portal-network.policy.js';
import {
  PortalSessions,
  type PortalViewer,
  type ViewerMessage,
} from './portal-sessions.service.js';

const TRANSCRIPT_HTML = `<title>Unofficial Transcript</title>
  <h2>Academic Transcript</h2>
  <table>
    <tr><th>Course Code</th><th>Title</th><th>Credits</th><th>Grade</th></tr>
    <tr><td>CSCI 250</td><td>Data Structures</td><td>3</td><td>B+</td></tr>
    <tr><td>MATH 210</td><td>Calculus</td><td>3</td><td>A</td></tr>
    <tr><td>ENGL 101</td><td>English</td><td>3</td><td>C</td></tr>
  </table>
  <p>Fall 2023, Spring 2024. GPA 3.1, credits 45</p>`;

/** A fake university portal: a login page and a transcript page. */
function startPortal(): Promise<Server> {
  const server = createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/html',
      'Set-Cookie': 'seen=1; Path=/',
    });
    if (req.url === '/student/transcript') {
      res.end(TRANSCRIPT_HTML);
    } else {
      res.end(`<title>Login</title><h1>Sign in</h1>
        <input id="user" style="position:absolute;left:10px;top:60px;width:200px;height:30px">
        <a id="go" href="/student/transcript" style="position:absolute;left:10px;top:120px">Transcript</a>`);
    }
  });
  server.listen(0, '127.0.0.1');
  return once(server, 'listening').then(() => server);
}

/** Collects what a session sends to a viewer, like a WebSocket would. */
class FakeViewer implements PortalViewer {
  readonly messages: ViewerMessage[] = [];
  closed: { code: number; reason: string } | null = null;
  private onCloseHandler: (() => void) | null = null;

  send(message: ViewerMessage): void {
    this.messages.push(message);
  }
  close(code: number, reason: string): void {
    this.closed = { code, reason };
    this.onCloseHandler?.();
  }
  onClose(handler: () => void): void {
    this.onCloseHandler = handler;
  }
  /** The viewer disconnects (tab closed, network lost). */
  disconnect(): void {
    this.onCloseHandler?.();
  }
  last(type: ViewerMessage['type']) {
    return this.messages.filter((m) => m.type === type).at(-1);
  }
}

const until = async (check: () => boolean | Promise<boolean>, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('Timed out waiting');
};

describe('PortalSessions (real browser, fake portal)', () => {
  let portal: Server;
  let base: string;
  let sessions: PortalSessions;

  const create = (over: Record<string, unknown> = {}, timings = {}) => {
    const config = new ConfigService<EnvironmentVariables, true>({
      PORTAL_START_URL: `${base}/login/`,
      PORTAL_ALLOWED_HOSTS: 'localhost',
      PORTAL_MAX_SESSIONS: 2,
      PORTAL_IDLE_MINUTES: 10,
      ...over,
    });
    // The fake portal is on loopback, which the real policy blocks; allow it here only.
    const policy = new PortalNetworkPolicy(
      config,
      (ip) => ip === '127.0.0.1' || ip === '::1',
    );
    return new PortalSessions(config, policy, {
      detectIntervalMs: 200,
      ...timings,
    });
  };

  beforeAll(async () => {
    portal = await startPortal();
    base = `http://localhost:${(portal.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    portal.close();
  });

  afterEach(async () => {
    await sessions?.onModuleDestroy();
  });

  it('starts a browser on the portal login page', async () => {
    sessions = create();

    const status = await sessions.start('u1');

    expect(status).toMatchObject({ running: true, url: `${base}/login/` });
    expect(sessions.status('u1').running).toBe(true);
    expect(sessions.status('u2').running).toBe(false);
  }, 30_000);

  it('reuses the running session when the same student starts again', async () => {
    sessions = create();
    await sessions.start('u1');

    await sessions.start('u1');

    expect(sessions.count()).toBe(1);
  }, 30_000);

  it('refuses a new session when all browsers are busy (503)', async () => {
    sessions = create({ PORTAL_MAX_SESSIONS: 1 });
    await sessions.start('u1');

    await expect(sessions.start('u2')).rejects.toThrow(
      ServiceUnavailableException,
    );
    await expect(sessions.start('u2')).rejects.toThrow(
      'All remote browsers are busy',
    );
  }, 30_000);

  it("keeps each student's browser separate (cookies don't leak)", async () => {
    sessions = create();
    await sessions.start('u1');
    await sessions.start('u2');

    const u1 = sessions.page('u1');
    const u2 = sessions.page('u2');
    expect(u1 && u2 && u1.context()).not.toBe(u2?.context());

    await u1
      ?.context()
      .addCookies([{ name: 'only-u1', value: 'x', url: base }]);
    const u2Cookies = (await u2?.context().cookies()) ?? [];
    expect(u2Cookies.map((c) => c.name)).not.toContain('only-u1');
  }, 30_000);

  it('streams frames and status to a viewer, and replays its input', async () => {
    sessions = create();
    await sessions.start('u1');
    const viewer = new FakeViewer();
    expect(sessions.addViewer('u1', viewer)).toBe(true);

    await until(() => viewer.messages.some((m) => m.type === 'frame'));
    expect(viewer.last('status')).toMatchObject({ running: true });

    // Click into the input and type: the text lands in the remote page.
    await sessions.handleInput('u1', { type: 'click', x: 50, y: 75 });
    await sessions.handleInput('u1', {
      type: 'text',
      text: 'student@liu.edu.lb',
    });
    expect(await sessions.page('u1')?.inputValue('#user')).toBe(
      'student@liu.edu.lb',
    );
  }, 30_000);

  it('detects the transcript page, tells the viewer, and captures it', async () => {
    sessions = create();
    await sessions.start('u1');
    const viewer = new FakeViewer();
    sessions.addViewer('u1', viewer);

    await sessions.handleInput('u1', { type: 'click', x: 30, y: 125 }); // the "Transcript" link

    await until(
      () =>
        viewer.last('status')?.type === 'status' &&
        sessions.status('u1').onTranscript,
    );
    const capture = await sessions.getTranscript('u1');
    expect(capture.text).toContain('CSCI 250');
    expect(capture.file.mimeType).toBe('text/html');
    expect(capture.file.buffer.toString()).toContain('<table>');
    expect(sessions.status('u1').captured).toMatchObject({
      url: `${base}/student/transcript`,
    });
  }, 30_000);

  it('answers 409 when there is no session, or no transcript on screen', async () => {
    sessions = create();

    await expect(sessions.getTranscript('u1')).rejects.toThrow(
      'Open the portal browser first',
    );
    await sessions.start('u1');
    await expect(sessions.getTranscript('u1')).rejects.toThrow(
      ConflictException,
    );
    await expect(sessions.getTranscript('u1')).rejects.toThrow(
      'Open your transcript page in the portal first',
    );
  }, 30_000);

  it('closes a session nobody watches after the idle time, and tells nobody', async () => {
    sessions = create({}, { idleMs: 400 });
    await sessions.start('u1');
    const viewer = new FakeViewer();
    sessions.addViewer('u1', viewer);

    viewer.disconnect();
    await until(() => !sessions.status('u1').running, 3000);
  }, 30_000);

  it('keeps a watched session open past the idle time', async () => {
    sessions = create({}, { idleMs: 300 });
    await sessions.start('u1');
    sessions.addViewer('u1', new FakeViewer());

    await new Promise((r) => setTimeout(r, 700));
    expect(sessions.status('u1').running).toBe(true);
  }, 30_000);

  it('closes a session at its maximum lifetime, even while watched', async () => {
    sessions = create({}, { maxLifetimeMs: 500 });
    await sessions.start('u1');
    const viewer = new FakeViewer();
    sessions.addViewer('u1', viewer);

    await until(() => !sessions.status('u1').running, 3000);
    expect(viewer.last('stopped')).toEqual({
      type: 'stopped',
      reason: 'The session reached its time limit',
    });
  }, 30_000);

  it('stop() tells and disconnects the viewers', async () => {
    sessions = create();
    await sessions.start('u1');
    const viewer = new FakeViewer();
    sessions.addViewer('u1', viewer);

    await sessions.stop('u1', 'Stopped');

    expect(viewer.last('stopped')).toEqual({
      type: 'stopped',
      reason: 'Stopped',
    });
    expect(viewer.closed).toEqual({ code: 1000, reason: 'stopped' });
    expect(sessions.status('u1').running).toBe(false);
    expect(sessions.addViewer('u1', new FakeViewer())).toBe(false);
  }, 30_000);
});
