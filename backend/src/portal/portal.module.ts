import { Module } from '@nestjs/common';
import { PortalGateway } from './portal.gateway.js';
import { PortalNetworkPolicy } from './portal-network.policy.js';
import { PortalSessions } from './portal-sessions.service.js';
import { PortalTickets } from './portal-tickets.js';

/**
 * The remote student-portal browser. Gateways are registered as providers (not
 * controllers). PortalSessions and PortalTickets are exported for the /me/portal routes.
 */
@Module({
  providers: [
    PortalNetworkPolicy,
    PortalSessions,
    PortalTickets,
    PortalGateway,
  ],
  exports: [PortalSessions, PortalTickets],
})
export class PortalModule {}
