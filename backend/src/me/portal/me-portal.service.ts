import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { StudentDocumentType } from '../../generated/prisma/enums.js';
import { PORTAL_WS_PATH } from '../../portal/portal.gateway.js';
import {
  PortalSessions,
  type PortalStatus,
} from '../../portal/portal-sessions.service.js';
import { PortalTickets } from '../../portal/portal-tickets.js';
import {
  DocumentsService,
  type StudentDocumentDto,
} from '../documents/documents.service.js';
import { DocumentsRepository } from '../documents/documents.repository.js';

/** POST /me/portal: the session, plus a single-use ticket for its WebSocket. */
export interface PortalSessionDto {
  status: PortalStatus;
  ticket: string;
  socketPath: string;
}

/**
 * The /me/portal routes (v1: services/me/portal). The browser itself lives in
 * PortalSessions; the import reuses the document upload path, so a portal transcript
 * is stored and processed exactly like an uploaded one.
 */
@Injectable()
export class MePortalService {
  constructor(
    private readonly sessions: PortalSessions,
    private readonly tickets: PortalTickets,
    private readonly documents: DocumentsService,
    private readonly documentsRepo: DocumentsRepository,
  ) {}

  /**
   * Starts (or reuses) the student's portal browser and returns a ticket for its
   * WebSocket. Calling it again while a session runs just issues a new ticket, which
   * is how the page reconnects.
   */
  async start(userId: string): Promise<PortalSessionDto> {
    // The transcript is matched against the selected major, so that has to exist first.
    if (!(await this.documentsRepo.findSelection(userId))) {
      throw new UnprocessableEntityException('Select your university first');
    }
    const status = await this.sessions.start(userId);
    return {
      status,
      ticket: this.tickets.issue(userId),
      socketPath: PORTAL_WS_PATH,
    };
  }

  status(userId: string): PortalStatus {
    return this.sessions.status(userId);
  }

  async stop(userId: string): Promise<void> {
    await this.sessions.stop(userId, 'Stopped');
  }

  /**
   * Imports the transcript on screen: captures the page (HTML, or the transcript PDF),
   * stores it as a TRANSCRIPT document and queues it like an upload, then closes the
   * browser. If anything fails before the document is queued, the browser stays open
   * so the student can try again.
   */
  async importTranscript(userId: string): Promise<StudentDocumentDto[]> {
    const capture = await this.sessions.getTranscript(userId);
    const isPdf = capture.file.mimeType === 'application/pdf';

    const documents = await this.documents.upload(
      userId,
      StudentDocumentType.TRANSCRIPT,
      [
        {
          originalName: `portal-transcript.${isPdf ? 'pdf' : 'html'}`,
          buffer: capture.file.buffer,
          mimeType: capture.file.mimeType,
          size: capture.file.buffer.length,
        },
      ],
    );

    await this.sessions.stop(userId, 'Transcript imported');
    return documents;
  }
}
