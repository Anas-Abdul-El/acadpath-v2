import { PortalTickets } from './portal-tickets.js';

describe('PortalTickets (one-time WebSocket tickets)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('redeems a ticket for the user it was issued to', () => {
    const tickets = new PortalTickets(60_000);
    const ticket = tickets.issue('user-1');

    expect(ticket).toMatch(/^[0-9a-f-]{36}$/);
    expect(tickets.redeem(ticket)).toBe('user-1');
  });

  it('works once only', () => {
    const tickets = new PortalTickets(60_000);
    const ticket = tickets.issue('user-1');

    tickets.redeem(ticket);
    expect(tickets.redeem(ticket)).toBeNull();
  });

  it('expires after its lifetime', () => {
    vi.useFakeTimers();
    const tickets = new PortalTickets(60_000);
    const ticket = tickets.issue('user-1');

    vi.advanceTimersByTime(60_001);
    expect(tickets.redeem(ticket)).toBeNull();
  });

  it.each([null, undefined, '', 'made-up-ticket'])('refuses %s', (ticket) => {
    expect(new PortalTickets(60_000).redeem(ticket)).toBeNull();
  });
});
