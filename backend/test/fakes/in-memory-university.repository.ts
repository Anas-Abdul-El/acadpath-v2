import { randomUUID } from 'node:crypto';
import {
  DegreeType,
  ProcessingStatus,
} from '../../src/generated/prisma/enums.js';
import type {
  CatalogSummary,
  MajorRow,
  UniversityRepository,
  UniversityRow,
} from '../../src/me/university/university.repository.js';

/** Stands in for UniversityRepository in e2e tests: universities, majors, selections. */
export class InMemoryUniversityRepository implements Pick<
  UniversityRepository,
  keyof UniversityRepository
> {
  readonly universities = new Map<string, UniversityRow>();
  readonly majors = new Map<string, MajorRow>();
  /** userId → the selection saved for that student. */
  readonly selections = new Map<
    string,
    { universityId: string; majorId: string }
  >();

  listUniversities() {
    return Promise.resolve(
      [...this.universities.values()].map(
        ({ id, name, shortName, country }) => ({
          id,
          name,
          shortName,
          country,
        }),
      ),
    );
  }

  upsertUniversity(data: { name: string; country: string; city: string }) {
    const existing = [...this.universities.values()].find(
      (u) => u.name === data.name && u.country === data.country,
    );
    if (existing) return Promise.resolve(existing);
    const university: UniversityRow = {
      id: randomUUID(),
      shortName: null,
      website: null,
      catalogYear: null,
      ...data,
    };
    this.universities.set(university.id, university);
    return Promise.resolve(university);
  }

  findOrCreateMajor(universityId: string, name: string) {
    const existing = [...this.majors.values()].find(
      (m) =>
        m.universityId === universityId &&
        m.name.toLowerCase() === name.toLowerCase(),
    );
    if (existing) return Promise.resolve({ ...existing });
    const major: MajorRow = {
      id: randomUUID(),
      universityId,
      name,
      degreeType: DegreeType.BACHELOR,
      totalRequiredCredits: null,
      catalogStatus: ProcessingStatus.PENDING,
      catalogError: null,
    };
    this.majors.set(major.id, major);
    return Promise.resolve({ ...major });
  }

  saveSelection(userId: string, universityId: string, majorId: string) {
    const previousUniversityId =
      this.selections.get(userId)?.universityId ?? null;
    this.selections.set(userId, { universityId, majorId });
    return Promise.resolve({ previousUniversityId });
  }

  markMajorPending(majorId: string) {
    const major = this.majors.get(majorId);
    if (major) {
      major.catalogStatus = ProcessingStatus.PENDING;
      major.catalogError = null;
    }
    return Promise.resolve();
  }

  getCatalogSummary(universityId: string): Promise<CatalogSummary> {
    const university = this.universities.get(universityId);
    if (!university) throw new Error(`No university ${universityId}`);
    const majorCount = [...this.majors.values()].filter(
      (m) => m.universityId === universityId,
    ).length;
    return Promise.resolve({
      university,
      title: null,
      source: null,
      courseCount: 0,
      majorCount,
    });
  }
}
