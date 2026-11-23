import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { UnrecoverableError, type Job } from 'bullmq';
import { AiInvalidResponseError, AiUnavailableError } from '../ai/ai.errors.js';
import { AiService, type AiAttachment } from '../ai/ai.service.js';
import { StorageService } from '../storage/storage.service.js';
import { pdfToText } from '../web/pdf-to-text.js';
import { TranscriptDataDto } from './dto/transcript-data.dto.js';
import { matchRecords } from './transcript-matching.js';
import { TRANSCRIPT_EXTRACTION_PROMPT } from './transcript.prompts.js';
import {
  TRANSCRIPT_QUEUE,
  type TranscriptJobData,
} from './transcript.queue.js';
import {
  TranscriptRepository,
  type TranscriptJobContext,
} from './transcript.repository.js';

// Messages stored on the documents and shown to the student. Never raw error text.
const ERRORS = {
  invalidAi: 'The AI returned invalid transcript data',
  aiUnavailable: 'The AI provider failed, try again later',
  unexpected: 'Processing failed, try uploading again',
  noMatch: (major: string) =>
    `None of the courses in the uploaded files are in ${major}`,
  unreadable: (file: string) => `Could not read ${file}`,
};

/**
 * Turns uploaded transcripts into academic records, in the background (v1: the body
 * of uploadDocuments, which ran inside the request). Same retry rules as the catalog
 * worker: transient failures are retried by BullMQ, the rest fail at once.
 */
@Processor(TRANSCRIPT_QUEUE)
export class TranscriptProcessor extends WorkerHost {
  private readonly logger = new Logger(TranscriptProcessor.name);

  constructor(
    private readonly repo: TranscriptRepository,
    private readonly storage: StorageService,
    private readonly ai: AiService,
  ) {
    super();
  }

  async process(job: Job<TranscriptJobData>): Promise<void> {
    const { studentId, documentIds } = job.data;
    const context = await this.repo.findJobContext(studentId, documentIds);
    if (!context) {
      this.logger.warn(
        `Transcript job for student ${studentId}: nothing to process`,
      );
      return;
    }
    await this.repo.markProcessing(documentIds);

    try {
      const { documents, attachments } = await this.readDocuments(
        context,
        documentIds,
      );
      const transcript = await this.ai.askForJson(
        TRANSCRIPT_EXTRACTION_PROMPT,
        {
          universityName: context.universityName,
          majorName: context.majorName,
          documents,
        },
        TranscriptDataDto,
        { attachments },
      );

      const courses = await this.repo.listMajorCourses(context.majorId);
      const records = matchRecords(transcript.records, courses);
      if (records.length === 0) {
        throw await this.stop(documentIds, ERRORS.noMatch(context.majorName));
      }

      await this.repo.replaceAcademicRecords(studentId, records, documentIds);
    } catch (error) {
      if (error instanceof UnrecoverableError) throw error;
      if (error instanceof AiInvalidResponseError) {
        throw await this.stop(documentIds, ERRORS.invalidAi);
      }

      const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      this.logger.warn(
        `Transcript job for student ${studentId} failed (attempt ${job.attemptsMade + 1}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      if (isLastAttempt) {
        await this.repo.markFailed(
          documentIds,
          error instanceof AiUnavailableError
            ? ERRORS.aiUnavailable
            : ERRORS.unexpected,
        );
      }
      throw error;
    }
  }

  /**
   * PDFs with a text layer go to the AI as text (smaller and cheaper); images and
   * scanned PDFs are attached for the vision model. Contents are never logged.
   */
  private async readDocuments(
    context: TranscriptJobContext,
    documentIds: string[],
  ) {
    const documents: { fileName: string; text: string }[] = [];
    const attachments: AiAttachment[] = [];

    for (const document of context.documents) {
      const data = await this.storage.get(document.fileUrl);
      if (document.mimeType === 'application/pdf') {
        let text: string;
        try {
          text = await pdfToText(data);
        } catch {
          throw await this.stop(
            documentIds,
            ERRORS.unreadable(document.fileName),
          );
        }
        if (text.length > 0) {
          documents.push({ fileName: document.fileName, text });
          continue;
        }
      }
      attachments.push({
        data,
        mimeType: document.mimeType,
        fileName: document.fileName,
      });
    }
    return { documents, attachments };
  }

  /**
   * Marks the documents failed and returns the error that tells BullMQ not to retry
   * (retrying wouldn't help). Used as `throw await this.stop(...)`.
   */
  private async stop(
    documentIds: string[],
    error: string,
  ): Promise<UnrecoverableError> {
    await this.repo.markFailed(documentIds, error);
    return new UnrecoverableError(error);
  }
}
