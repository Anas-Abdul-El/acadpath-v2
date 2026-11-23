import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { ProcessingStatus } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { MajorDto, UniversityDto } from '../me.types.js';

export type UniversityRow = UniversityDto;

/** A major with its catalog extraction state (internal; not sent as is). */
export interface MajorRow extends MajorDto {
  catalogStatus: ProcessingStatus;
  catalogError: string | null;
}

export interface CatalogSummary {
  university: UniversityRow;
  /** Title and host of the newest processed source, for "catalog from liu.edu.lb". */
  title: string | null;
  source: string | null;
  courseCount: number;
  majorCount: number;
}

const universitySelect = {
  id: true,
  name: true,
  shortName: true,
  country: true,
  city: true,
  website: true,
  catalogYear: true,
} as const satisfies Prisma.UniversitySelect;

const majorSelect = {
  id: true,
  universityId: true,
  name: true,
  degreeType: true,
  totalRequiredCredits: true,
  catalogStatus: true,
  catalogError: true,
} as const satisfies Prisma.MajorSelect;

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002';

/** Queries for PUT /me/university (v1: listUniversities … saveUniversitySelection in me.repo). */
@Injectable()
export class UniversityRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Only the four columns the matching needs. */
  listUniversities() {
    return this.prisma.university.findMany({
      select: { id: true, name: true, shortName: true, country: true },
    });
  }

  /** (name, country) is unique, so two students adding the same university get one row. */
  upsertUniversity(data: {
    name: string;
    country: string;
    city: string;
  }): Promise<UniversityRow> {
    return this.prisma.university.upsert({
      where: { name_country: { name: data.name, country: data.country } },
      create: data,
      update: {},
      select: universitySelect,
    });
  }

  /** Case-insensitive, so "computer science" reuses "Computer Science". New majors start PENDING. */
  async findOrCreateMajor(
    universityId: string,
    name: string,
  ): Promise<MajorRow> {
    const find = () =>
      this.prisma.major.findFirst({
        where: { universityId, name: { equals: name, mode: 'insensitive' } },
        select: majorSelect,
      });

    const existing = await find();
    if (existing) return existing;
    try {
      return await this.prisma.major.create({
        data: { universityId, name },
        select: majorSelect,
      });
    } catch (error) {
      // Another request created it between our read and write: use theirs.
      if (isUniqueViolation(error)) {
        const created = await find();
        if (created) return created;
      }
      throw error;
    }
  }

  /** Saves the student's choice and returns the university it replaced, in one transaction. */
  saveSelection(
    userId: string,
    universityId: string,
    majorId: string,
  ): Promise<{ previousUniversityId: string | null }> {
    return this.prisma.$transaction(async (tx) => {
      const previous = await tx.studentProfile.findUnique({
        where: { userId },
        select: { universityId: true },
      });
      await tx.studentProfile.upsert({
        where: { userId },
        create: { userId, universityId, majorId },
        update: { universityId, majorId },
        select: { id: true },
      });
      return { previousUniversityId: previous?.universityId ?? null };
    });
  }

  async markMajorPending(majorId: string): Promise<void> {
    await this.prisma.major.update({
      where: { id: majorId },
      data: { catalogStatus: ProcessingStatus.PENDING, catalogError: null },
    });
  }

  async getCatalogSummary(
    universityId: string,
    majorId: string,
  ): Promise<CatalogSummary> {
    const [university, newestSource, courseCount, majorCount] =
      await Promise.all([
        this.prisma.university.findUniqueOrThrow({
          where: { id: universityId },
          select: universitySelect,
        }),
        this.prisma.courseMaterialSource.findFirst({
          where: {
            universityId,
            errorMessage: null,
            lastProcessedAt: { not: null },
          },
          orderBy: { lastProcessedAt: 'desc' },
          select: { title: true, url: true },
        }),
        this.prisma.course.count({ where: { majorId } }),
        this.prisma.major.count({ where: { universityId } }),
      ]);

    return {
      university,
      title: newestSource?.title ?? null,
      source:
        newestSource && URL.canParse(newestSource.url)
          ? new URL(newestSource.url).hostname
          : null,
      courseCount,
      majorCount,
    };
  }
}
