import { Injectable } from '@nestjs/common';
import { ProcessingStatus } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { MatchedRecord } from './transcript-matching.js';

export interface TranscriptJobContext {
  universityName: string;
  majorId: string;
  majorName: string;
  documents: {
    id: string;
    fileName: string;
    fileUrl: string;
    mimeType: string;
  }[];
}

/** Reads and writes for the transcript worker. */
@Injectable()
export class TranscriptRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The student's selection and the job's documents; null if either is gone. */
  async findJobContext(
    studentId: string,
    documentIds: string[],
  ): Promise<TranscriptJobContext | null> {
    const profile = await this.prisma.studentProfile.findUnique({
      where: { id: studentId },
      select: {
        university: { select: { name: true } },
        major: { select: { id: true, name: true } },
        // Scoped to this student: a job can only read its own student's documents.
        documents: {
          where: { id: { in: documentIds } },
          select: { id: true, fileName: true, fileUrl: true, mimeType: true },
        },
      },
    });
    if (!profile?.university || !profile.major) return null;

    const documents = profile.documents.flatMap((d) =>
      d.fileUrl ? [{ ...d, fileUrl: d.fileUrl }] : [],
    );
    if (documents.length === 0) return null;

    return {
      universityName: profile.university.name,
      majorId: profile.major.id,
      majorName: profile.major.name,
      documents,
    };
  }

  async markProcessing(documentIds: string[]): Promise<void> {
    await this.prisma.studentDocument.updateMany({
      where: { id: { in: documentIds } },
      data: { status: ProcessingStatus.PROCESSING, errorMessage: null },
    });
  }

  async markFailed(documentIds: string[], error: string): Promise<void> {
    await this.prisma.studentDocument.updateMany({
      where: { id: { in: documentIds } },
      data: {
        status: ProcessingStatus.FAILED,
        errorMessage: error,
        processedAt: new Date(),
      },
    });
  }

  listMajorCourses(majorId: string): Promise<{ id: string; code: string }[]> {
    return this.prisma.course.findMany({
      where: { majorId },
      select: { id: true, code: true },
    });
  }

  /**
   * In one transaction: the student's academic records become exactly these (as in
   * v1, an upload replaces them), and the documents are marked COMPLETED.
   */
  async replaceAcademicRecords(
    studentId: string,
    records: MatchedRecord[],
    documentIds: string[],
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.academicRecord.deleteMany({ where: { studentId } });
      await tx.academicRecord.createMany({
        data: records.map((record) => ({ ...record, studentId })),
      });
      await tx.studentDocument.updateMany({
        where: { id: { in: documentIds } },
        data: {
          status: ProcessingStatus.COMPLETED,
          errorMessage: null,
          processedAt: new Date(),
        },
      });
    });
  }
}
