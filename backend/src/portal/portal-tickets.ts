import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';

/** Injection token to change the ticket lifetime (tests). */
export const PORTAL_TICKET_TTL = Symbol('PORTAL_TICKET_TTL');

/**
 * Single-use tickets for the portal WebSocket (v1: issuePortalTicket / redeemPortalTicket).
 *
 * A browser can't send an Authorization header when it opens a WebSocket, and an access
 * token in the URL could end up in logs. So the authenticated POST /me/portal hands out
 * a random ticket valid for a minute, and the WebSocket redeems it exactly once.
 * In memory, so it only works with a single backend process (as in v1).
 */
@Injectable()
export class PortalTickets {
  private readonly tickets = new Map<
    string,
    { userId: string; expires: number }
  >();

  constructor(
    @Optional()
    @Inject(PORTAL_TICKET_TTL)
    private readonly ttlMs: number = 60_000,
  ) {}

  issue(userId: string): string {
    const now = Date.now();
    for (const [key, entry] of this.tickets) {
      if (entry.expires <= now) this.tickets.delete(key);
    }

    const ticket = randomUUID();
    this.tickets.set(ticket, { userId, expires: now + this.ttlMs });
    return ticket;
  }

  /** The ticket's user, or null. A ticket is deleted on first use, valid or not. */
  redeem(ticket: string | null | undefined): string | null {
    if (!ticket) return null;
    const entry = this.tickets.get(ticket);
    this.tickets.delete(ticket);
    if (!entry || entry.expires <= Date.now()) return null;
    return entry.userId;
  }
}
