import { Injectable } from '@nestjs/common';
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
    const { majorId, universityId, courses, sources } = extraction;
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
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
        data: buildRequisites(
          courses,
          new Map(saved.map((c) => [c.code, c.id])),
        ),
        skipDuplicates: true,
      });

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

      await tx.major.update({
        where: { id: majorId },
        data: {
          // Only fill in the total when the sources stated one.
          ...(extraction.totalRequiredCredits !== null && {
            totalRequiredCredits: extraction.totalRequiredCredits,
          }),
          catalogStatus: ProcessingStatus.COMPLETED,
          catalogError: null,
          catalogProcessedAt: now,
        },
      });
    });
  }
}
