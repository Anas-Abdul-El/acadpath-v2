import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import {
  ProcessingStatus,
  type StudentDocumentType,
} from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';

// fileUrl (the storage key) is left out: it never goes to the client.
const documentSelect = {
  id: true,
  type: true,
  fileName: true,
  mimeType: true,
  fileSize: true,
  status: true,
  errorMessage: true,
  processedAt: true,
  createdAt: true,
} as const satisfies Prisma.StudentDocumentSelect;

export type DocumentRow = Prisma.StudentDocumentGetPayload<{
  select: typeof documentSelect;
}>;

/** Queries for the /me/documents routes (v1: listDocuments, saveDocuments in me.repo). */
@Injectable()
export class DocumentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The student's profile id and their major's catalog status; null without a major. */
  async findSelection(userId: string): Promise<{
    studentId: string;
    catalogStatus: ProcessingStatus | null;
  } | null> {
    const profile = await this.prisma.studentProfile.findUnique({
      where: { userId },
      select: {
        id: true,
        university: { select: { id: true } },
        major: { select: { catalogStatus: true } },
      },
    });
    if (!profile?.university || !profile.major) return null;
    return {
      studentId: profile.id,
      catalogStatus: profile.major.catalogStatus,
    };
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
  ): Promise<DocumentRow[]> {
    return this.prisma.studentDocument.createManyAndReturn({
      data: files.map((file) => ({
        ...file,
        studentId,
        type,
        status: ProcessingStatus.PENDING,
      })),
      select: documentSelect,
    });
  }

  async markFailed(documentIds: string[], error: string): Promise<void> {
    await this.prisma.studentDocument.updateMany({
      where: { id: { in: documentIds } },
      data: { status: ProcessingStatus.FAILED, errorMessage: error },
    });
  }

  /** Scoped by the user id from the token, through the profile relation. */
  listDocuments(
    userId: string,
    type?: StudentDocumentType,
  ): Promise<DocumentRow[]> {
    return this.prisma.studentDocument.findMany({
      where: { student: { userId }, ...(type && { type }) },
      select: documentSelect,
      orderBy: { createdAt: 'desc' },
    });
  }
}
