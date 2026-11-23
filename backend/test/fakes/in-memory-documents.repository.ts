import { randomUUID } from 'node:crypto';
import {
  ProcessingStatus,
  type StudentDocumentType,
} from '../../src/generated/prisma/enums.js';
import type {
  DocumentRow,
  DocumentsRepository,
} from '../../src/me/documents/documents.repository.js';

/** Stands in for DocumentsRepository: selections and documents per user, in Maps. */
export class InMemoryDocumentsRepository implements Pick<
  DocumentsRepository,
  keyof DocumentsRepository
> {
  /** userId → the student's profile id and major catalog status. */
  readonly selections = new Map<
    string,
    { studentId: string; catalogStatus: ProcessingStatus | null }
  >();
  /** studentId → documents. */
  readonly documents = new Map<string, DocumentRow[]>();

  findSelection(userId: string) {
    return Promise.resolve(this.selections.get(userId) ?? null);
  }

  createDocuments(
    studentId: string,
    type: StudentDocumentType,
    files: {
      fileName: string;
      fileUrl: string;
      mimeType: string;
      fileSize: number;
    }[],
  ) {
    const rows: DocumentRow[] = files.map((file) => ({
      id: randomUUID(),
      type,
      fileName: file.fileName,
      mimeType: file.mimeType,
      fileSize: file.fileSize,
      status: ProcessingStatus.PENDING,
      errorMessage: null,
      processedAt: null,
      createdAt: new Date(),
    }));
    this.documents.set(studentId, [
      ...rows,
      ...(this.documents.get(studentId) ?? []),
    ]);
    return Promise.resolve(rows);
  }

  markFailed(documentIds: string[], error: string) {
    for (const docs of this.documents.values()) {
      for (const doc of docs) {
        if (documentIds.includes(doc.id)) {
          doc.status = ProcessingStatus.FAILED;
          doc.errorMessage = error;
        }
      }
    }
    return Promise.resolve();
  }

  listDocuments(userId: string, type?: StudentDocumentType) {
    const studentId = this.selections.get(userId)?.studentId;
    const docs = studentId ? (this.documents.get(studentId) ?? []) : [];
    return Promise.resolve(docs.filter((d) => !type || d.type === type));
  }
}
