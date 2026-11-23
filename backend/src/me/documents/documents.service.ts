import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  ProcessingStatus,
  type StudentDocumentType,
} from '../../generated/prisma/enums.js';
import { StorageService } from '../../storage/storage.service.js';
import { storeFiles, type FileInput } from '../../storage/store-files.js';
import { TranscriptQueue } from '../../transcripts/transcript.queue.js';
import {
  DocumentsRepository,
  type DocumentRow,
} from './documents.repository.js';

/** A document as the client sees it (v1: StudentDocumentDto). */
export interface StudentDocumentDto {
  id: string;
  type: StudentDocumentType;
  fileName: string;
  mimeType: string;
  fileSize: number;
  status: ProcessingStatus;
  errorMessage: string | null;
  processedAt: string | null;
  createdAt: string;
}

const toDto = (row: DocumentRow): StudentDocumentDto => ({
  ...row,
  processedAt: row.processedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
});

/**
 * POST and GET /me/documents (v1: services/me/documents). The upload only stores the
 * files and queues the work; TranscriptProcessor reads them later.
 */
@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly repo: DocumentsRepository,
    private readonly storage: StorageService,
    private readonly transcriptQueue: TranscriptQueue,
  ) {}

  async upload(
    userId: string,
    type: StudentDocumentType,
    files: FileInput[],
  ): Promise<StudentDocumentDto[]> {
    const selection = await this.repo.findSelection(userId);
    if (!selection) {
      throw new UnprocessableEntityException('Select your university first');
    }
    // Records are matched to the major's courses, so the catalog must be there first.
    if (selection.catalogStatus !== ProcessingStatus.COMPLETED) {
      throw new UnprocessableEntityException(
        "Your university's course catalog isn't ready yet",
      );
    }

    const stored = await storeFiles(
      this.storage,
      'documents',
      selection.studentId,
      files,
    );
    const documents = await this.repo.createDocuments(
      selection.studentId,
      type,
      stored.map(({ file, key }) => ({
        fileName: file.originalName,
        fileUrl: key,
        mimeType: file.mimeType,
        fileSize: file.size,
      })),
    );
    const documentIds = documents.map((d) => d.id);

    try {
      await this.transcriptQueue.enqueue({
        studentId: selection.studentId,
        documentIds,
      });
    } catch (error) {
      this.logger.error('Could not queue transcript extraction', error);
      await this.repo.markFailed(
        documentIds,
        'Processing could not start, upload the files again',
      );
      throw new ServiceUnavailableException(
        'Document processing is unavailable, try again later',
      );
    }

    return documents.map(toDto);
  }

  async list(
    userId: string,
    type?: StudentDocumentType,
  ): Promise<StudentDocumentDto[]> {
    return (await this.repo.listDocuments(userId, type)).map(toDto);
  }
}
