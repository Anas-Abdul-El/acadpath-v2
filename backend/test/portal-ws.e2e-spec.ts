import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import WebSocket from 'ws';
import type { App } from 'supertest/types.js';
import type { PortalInput } from './../src/portal/portal-input.js';
import {
  PortalSessions,
  type PortalViewer,
} from './../src/portal/portal-sessions.service.js';
import { PortalTickets } from './../src/portal/portal-tickets.js';
import { createTestApp } from './utils/create-test-app.js';

const ORIGIN = 'http://localhost:3000'; // the default CORS_ORIGIN

/** Stands in for PortalSessions: no browser, records what the gateway does. */
class FakeSessions {
  readonly viewers = new Map<string, PortalViewer>();
  readonly inputs: { userId: string; input: PortalInput }[] = [];
  running = new Set<string>(['u1']);

  addViewer(userId: string, viewer: PortalViewer): boolean {
    if (!this.running.has(userId)) return false;
    this.viewers.set(userId, viewer);
    viewer.send({ type: 'frame', data: 'AAAA' });
    return true;
  }
  handleInput(userId: string, input: PortalInput): Promise<void> {
    this.inputs.push({ userId, input });
    return Promise.resolve();
  }
  onModuleDestroy(): Promise<void> {
    return Promise.resolve();
  }
}

describe('Portal WebSocket (e2e)', () => {
  let app: INestApplication<App>;
  let sessions: FakeSessions;
  let tickets: PortalTickets;
  let url: string;

  beforeEach(async () => {
    sessions = new FakeSessions();
    ({ app } = await createTestApp({
      overrides: [[PortalSessions, sessions]],
    }));
    await app.listen(0, '127.0.0.1');
    const server = app.getHttpServer() as unknown as { address(): AddressInfo };
    const { port } = server.address();
    url = `ws://127.0.0.1:${port}/api/me/portal/ws`;
    tickets = app.get(PortalTickets);
  });

  afterEach(async () => {
    await app.close();
  });

  /** Opens a socket and resolves with how it ended or the first message. */
  const connect = (query: string, origin: string | null = ORIGIN) => {
    const ws = new WebSocket(`${url}${query}`, origin ? { origin } : {});
    const messages: unknown[] = [];
    ws.on('message', (raw) =>
      messages.push(JSON.parse((raw as Buffer).toString('utf8'))),
    );
    const closed = once(ws, 'close').then(([code]) => code as number);
    const failed = once(ws, 'error').then(() => 'error' as const);
    return { ws, messages, closed, failed };
  };

  const waitFor = async (check: () => boolean, ms = 2000) => {
    const end = Date.now() + ms;
    while (!check()) {
      if (Date.now() > end) throw new Error('Timed out waiting');
      await new Promise((r) => setTimeout(r, 20));
    }
  };

  it('accepts a valid ticket from the frontend origin and streams to it', async () => {
    const { messages } = connect(`?ticket=${tickets.issue('u1')}`);

    await waitFor(() => messages.length > 0);
    expect(messages[0]).toEqual({ type: 'frame', data: 'AAAA' });
  });

  it('passes valid input on to the session, as the ticket owner', async () => {
    const { ws, messages } = connect(`?ticket=${tickets.issue('u1')}`);
    await waitFor(() => messages.length > 0);

    ws.send(JSON.stringify({ type: 'click', x: 10, y: 20 }));
    ws.send(JSON.stringify({ type: 'text', text: 'hello' }));

    await waitFor(() => sessions.inputs.length === 2);
    expect(sessions.inputs).toEqual([
      { userId: 'u1', input: { type: 'click', x: 10, y: 20 } },
      { userId: 'u1', input: { type: 'text', text: 'hello' } },
    ]);
  });

  it("doesn't count viewer input against the HTTP rate limits (a session sends hundreds)", async () => {
    const { ws, messages } = connect(`?ticket=${tickets.issue('u1')}`);
    await waitFor(() => messages.length > 0);

    for (let i = 0; i < 250; i++)
      ws.send(JSON.stringify({ type: 'scroll', deltaY: 10 }));

    await waitFor(() => sessions.inputs.length === 250, 5000);
  });

  it('ignores invalid input and keeps the connection open', async () => {
    const { ws, messages } = connect(`?ticket=${tickets.issue('u1')}`);
    await waitFor(() => messages.length > 0);

    ws.send('not json');
    ws.send(
      JSON.stringify({ type: 'navigate', url: 'http://169.254.169.254/' }),
    );
    ws.send(JSON.stringify({ type: 'key', key: 'F12' }));
    ws.send(JSON.stringify({ type: 'back' }));

    await waitFor(() => sessions.inputs.length === 1);
    expect(sessions.inputs).toEqual([
      { userId: 'u1', input: { type: 'back' } },
    ]);
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });

  it.each([
    ['no ticket', '', 4401],
    ['an unknown ticket', '?ticket=made-up', 4401],
  ])('closes the socket for %s (%i)', async (_case, query, code) => {
    const { closed } = connect(query);

    expect(await closed).toBe(code);
  });

  it('accepts a ticket once only', async () => {
    const ticket = tickets.issue('u1');
    const first = connect(`?ticket=${ticket}`);
    await waitFor(() => first.messages.length > 0);

    const second = connect(`?ticket=${ticket}`);
    expect(await second.closed).toBe(4401);
  });

  it('refuses another origin, even with a valid ticket (4403)', async () => {
    const { closed } = connect(
      `?ticket=${tickets.issue('u1')}`,
      'https://evil.example',
    );

    expect(await closed).toBe(4403);
  });

  it('refuses a connection without an Origin header (4403)', async () => {
    const { closed } = connect(`?ticket=${tickets.issue('u1')}`, null);

    expect(await closed).toBe(4403);
  });

  it('closes with 4404 when the student has no running session', async () => {
    const { closed } = connect(`?ticket=${tickets.issue('u2')}`);

    expect(await closed).toBe(4404);
  });

  it('closes the socket on a message over 16 KB', async () => {
    const { ws, messages, closed } = connect(`?ticket=${tickets.issue('u1')}`);
    await waitFor(() => messages.length > 0);

    ws.send(JSON.stringify({ type: 'text', text: 'x'.repeat(20_000) }));

    expect(await closed).toBe(1009); // "message too big"
  });

  it('serves no WebSocket on other paths', async () => {
    const other = new WebSocket(url.replace('/portal/ws', '/other'), {
      origin: ORIGIN,
    });

    await expect(once(other, 'open')).rejects.toBeDefined();
  });
});
