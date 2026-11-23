import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import {
  CourseSource,
  ProcessingStatus,
  SourceType,
} from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ReadPage } from '../web/page-reader.service.js';
import type { CourseDataDto } from './dto/major-data.dto.js';
import { buildRequisites } from './requisites.js';

const sourceTypes = { pdf: SourceType.PDF, html: SourceType.HTML } as const;
const notCompleted = { not: ProcessingStatus.COMPLETED };

/** Writes for the catalog worker: the major's status, and the extracted catalog. */
@Injectable()
export class CatalogRepository {
  constructor(private readonly prisma: PrismaService) {}

  async markProcessing(majorId: string): Promise<void> {
    await this.prisma.major.update({
      where: { id: majorId },
      data: { catalogStatus: ProcessingStatus.PROCESSING, catalogError: null },
    });
  }

  async markFailed(majorId: string, error: string): Promise<void> {
    await this.prisma.major.update({
      where: { id: majorId },
      data: {
        catalogStatus: ProcessingStatus.FAILED,
        catalogError: error,
        catalogProcessedAt: new Date(),
      },
    });
  }

  /**
   * Saves everything in one transaction, so a crash never leaves half a catalog: the
   * courses (tagged AI_EXTRACTED, not verified), their requisites, the source pages
   * (provenance), and the major marked COMPLETED (v1: me.repo saveMajorData).
   */
  async saveExtraction(extraction: {
    majorId: string;
    universityId: string;
    totalRequiredCredits: number | null;
    courses: CourseDataDto[];
    sources: ReadPage[];
  }): Promise<void> {
    const { majorId, universityId, sources } = extraction;
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      await saveCourses(tx, majorId, extraction.courses);
      await tx.courseMaterialSource.createMany({
        data: sources.map((source) => ({
          universityId,
          url: source.url,
          sourceType: sourceTypes[source.type],
          lastFetchedAt: now,
          lastProcessedAt: now,
        })),
        skipDuplicates: true,
      });
      await completeMajor(tx, majorId, extraction.totalRequiredCredits, now);
    });
  }

  // ─── Uploaded sources ─────────────────────────────────────

  findUploadedSources(sourceIds: string[]) {
    return this.prisma.courseMaterialSource.findMany({
      where: { id: { in: sourceIds } },
      select: { id: true, title: true, url: true, sourceType: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** A major that already has its catalog keeps COMPLETED while uploads are processed. */
  async markUploadProcessing(majorId: string): Promise<void> {
    await this.prisma.major.updateMany({
      where: { id: majorId, catalogStatus: notCompleted },
      data: { catalogStatus: ProcessingStatus.PROCESSING, catalogError: null },
    });
  }

  /** The sources get the reason; the major fails too, unless it already has a catalog. */
  async markUploadFailed(
    sourceIds: string[],
    majorId: string,
    error: string,
  ): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.courseMaterialSource.updateMany({
        where: { id: { in: sourceIds } },
        data: { errorMessage: error },
      }),
      this.prisma.major.updateMany({
        where: { id: majorId, catalogStatus: notCompleted },
        data: {
          catalogStatus: ProcessingStatus.FAILED,
          catalogError: error,
          catalogProcessedAt: now,
        },
      }),
    ]);
  }

  async saveUploadedExtraction(extraction: {
    majorId: string;
    totalRequiredCredits: number | null;
    courses: CourseDataDto[];
    sourceIds: string[];
  }): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await saveCourses(tx, extraction.majorId, extraction.courses);
      await tx.courseMaterialSource.updateMany({
        where: { id: { in: extraction.sourceIds } },
        data: { lastProcessedAt: now, errorMessage: null },
      });
      await completeMajor(
        tx,
        extraction.majorId,
        extraction.totalRequiredCredits,
        now,
      );
    });
  }
}

/** Courses (new ones only) and their prerequisite/corequisite links. */
async function saveCourses(
  tx: Prisma.TransactionClient,
  majorId: string,
  courses: CourseDataDto[],
): Promise<void> {
  await tx.course.createMany({
    data: courses.map((course) => ({
      majorId,
      code: course.code,
      name: course.name,
      description: course.description,
      credits: course.credits,
      category: course.category,
      offeredTerms: course.offeredTerms,
      source: CourseSource.AI_EXTRACTED,
    })),
    skipDuplicates: true,
  });

  // One query for all ids, instead of one per course.
  const saved = await tx.course.findMany({
    where: { majorId },
    select: { id: true, code: true },
  });
  await tx.coursePrerequisite.createMany({
    data: buildRequisites(courses, new Map(saved.map((c) => [c.code, c.id]))),
    skipDuplicates: true,
  });
}

async function completeMajor(
  tx: Prisma.TransactionClient,
  majorId: string,
  totalRequiredCredits: number | null,
  now: Date,
): Promise<void> {
  await tx.major.update({
    where: { id: majorId },
    data: {
      // Only fill in the total when the sources stated one.
      ...(totalRequiredCredits !== null && { totalRequiredCredits }),
      catalogStatus: ProcessingStatus.COMPLETED,
      catalogError: null,
      catalogProcessedAt: now,
    },
  });
}
