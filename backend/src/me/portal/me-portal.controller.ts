import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import type { AuthUser } from '../../auth/auth.types.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { Roles } from '../../auth/decorators/roles.decorator.js';
import { Polled } from '../../common/decorators/polled.decorator.js';
import { UserRateLimit } from '../../common/decorators/user-rate-limit.decorator.js';
import { UserRole } from '../../generated/prisma/enums.js';
import type { PortalStatus } from '../../portal/portal-sessions.service.js';
import type { StudentDocumentDto } from '../documents/documents.service.js';
import { MePortalService, type PortalSessionDto } from './me-portal.service.js';

/**
 * /api/me/portal: the remote browser a student uses to sign in to their university
 * portal and open their transcript. The screen itself streams over the WebSocket at
 * /api/me/portal/ws (PortalGateway); these routes start, inspect, stop and import.
 */
@Controller('me/portal')
@Roles(UserRole.STUDENT)
export class MePortalController {
  constructor(private readonly portal: MePortalService) {}

  /** 200 with the status and a WebSocket ticket. Starting launches Chromium: limited per user. */
  @Post()
  @HttpCode(HttpStatus.OK)
  @UserRateLimit('portal')
  async start(
    @CurrentUser() user: AuthUser,
  ): Promise<{ data: PortalSessionDto }> {
    return { data: await this.portal.start(user.id) };
  }

  @Get()
  @Polled()
  status(@CurrentUser() user: AuthUser): { data: PortalStatus } {
    return { data: this.portal.status(user.id) };
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async stop(@CurrentUser() user: AuthUser): Promise<void> {
    await this.portal.stop(user.id);
  }

  /** 202: the transcript is stored and queued; follow it with GET /me/documents. */
  @Post('transcript')
  @HttpCode(HttpStatus.ACCEPTED)
  @UserRateLimit('ai')
  async importTranscript(
    @CurrentUser() user: AuthUser,
  ): Promise<{ data: StudentDocumentDto[] }> {
    return { data: await this.portal.importTranscript(user.id) };
  }
}
