import type { IncomingMessage } from 'node:http';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  type OnGatewayConnection,
} from '@nestjs/websockets';
import type { WebSocket } from 'ws';
import {
  parseList,
  type EnvironmentVariables,
} from '../config/env.validation.js';
import { parsePortalInput } from './portal-input.js';
import {
  PortalSessions,
  type PortalViewer,
  type ViewerMessage,
} from './portal-sessions.service.js';
import { PortalTickets } from './portal-tickets.js';

export const PORTAL_WS_PATH = '/api/me/portal/ws';
/** Every frame from the viewer is one input event (see portalMessageParser). */
export const PORTAL_INPUT_EVENT = 'input';

// Close codes the frontend can tell apart (4000–4999 are free for applications).
const CLOSE = {
  unauthorized: [4401, 'Unauthorized'],
  forbidden: [4403, 'Forbidden'],
  noSession: [4404, 'No portal session'],
} as const;

/** A WebSocket as a PortalViewer: what the session manager needs from it. */
const toViewer = (client: WebSocket): PortalViewer => ({
  send: (message: ViewerMessage) => {
    if (client.readyState === client.OPEN) client.send(JSON.stringify(message));
  },
  close: (code, reason) => client.close(code, reason),
  onClose: (handler) => client.on('close', handler),
});

/**
 * The WebSocket between the onboarding page and the student's remote browser
 * (v1: libs/portal/socket.ts, a raw `ws` server on Express's upgrade event).
 *   server → client: { type: "frame" | "status" | "stopped", ... }
 *   client → server: clicks, scrolls, keys, text, back, reload, resize
 *
 * A gateway is to WebSockets what a controller is to HTTP: Nest creates it, injects
 * its providers, and routes messages to @SubscribeMessage() handlers. The global
 * guards don't protect it; it authenticates each connection itself, with the origin
 * and a single-use ticket from POST /me/portal.
 * Docs: https://docs.nestjs.com/websockets/gateways
 */
@WebSocketGateway({ path: PORTAL_WS_PATH })
export class PortalGateway implements OnGatewayConnection<WebSocket> {
  private readonly logger = new Logger(PortalGateway.name);
  private readonly allowedOrigins: string[];
  /** Which student each authenticated socket belongs to. */
  private readonly owners = new WeakMap<WebSocket, string>();

  constructor(
    private readonly sessions: PortalSessions,
    private readonly tickets: PortalTickets,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.allowedOrigins = parseList(
      config.getOrThrow('CORS_ORIGIN', { infer: true }),
    );
  }

  /**
   * Runs once per new connection. Synchronous on purpose: messages can arrive before
   * an async handler finishes, and handleInput ignores sockets with no owner yet.
   */
  handleConnection(client: WebSocket, request: IncomingMessage): void {
    // Browsers always send Origin on WebSockets, and CORS doesn't apply to them, so
    // check it here: only our frontend may open the stream.
    const origin = request.headers.origin?.toLowerCase();
    if (!origin || !this.allowedOrigins.includes(origin)) {
      client.close(...CLOSE.forbidden);
      return;
    }

    const ticket = new URL(
      request.url ?? '/',
      'http://localhost',
    ).searchParams.get('ticket');
    const userId = this.tickets.redeem(ticket);
    if (!userId) {
      client.close(...CLOSE.unauthorized);
      return;
    }

    if (!this.sessions.addViewer(userId, toViewer(client))) {
      client.close(...CLOSE.noSession);
      return;
    }
    this.owners.set(client, userId);
  }

  /** Every viewer message: validated, then replayed on the owner's page. */
  @SubscribeMessage(PORTAL_INPUT_EVENT)
  handleInput(
    @ConnectedSocket() client: WebSocket,
    @MessageBody() body: unknown,
  ): void {
    const userId = this.owners.get(client);
    if (!userId) return;

    const input = parsePortalInput(body);
    if (!input) return;

    this.sessions.handleInput(userId, input).catch((error: unknown) => {
      // The input type only: never what was typed.
      this.logger.debug(
        `Portal input ${input.type} failed: ${error instanceof Error ? error.message : ''}`,
      );
    });
  }
}

/**
 * v1's frames are plain JSON ({ type: "click", ... }), while Nest's WsAdapter expects
 * { event, data }. This parser wraps every frame as one "input" event, so the frontend
 * keeps v1's format. Anything that isn't a JSON object is dropped silently (returning
 * nothing), so a client can't flood the logs with garbage.
 */
export function portalMessageParser(
  raw: string | Buffer | ArrayBuffer | Buffer[],
): { event: string; data: unknown } | void {
  const text = Array.isArray(raw)
    ? Buffer.concat(raw).toString('utf8')
    : Buffer.from(raw as ArrayBuffer).toString('utf8');
  try {
    const data: unknown = JSON.parse(text);
    if (typeof data === 'object' && data !== null) {
      return { event: PORTAL_INPUT_EVENT, data };
    }
  } catch {
    // Not JSON: dropped.
  }
}
