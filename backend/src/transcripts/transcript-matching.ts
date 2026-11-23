import type {
  AcademicRecordStatus,
  LetterGrade,
  Term,
} from '../generated/prisma/enums.js';
import type { TranscriptRecordDto } from './dto/transcript-data.dto.js';

/** "csci 250" and "CSCI250" are the same course (v1: shared/courses.ts). */
export const normalizeCode = (code: string): string =>
  code.toUpperCase().replace(/\s+/g, '');

export interface MatchedRecord {
  courseId: string;
  status: AcademicRecordStatus;
  grade: LetterGrade | null;
  term: Term;
  year: number;
}

/**
 * Links transcript records to the courses of the student's major (v1:
 * matchRecordsToMajorCourses). Deterministic: a record whose code isn't a course of
 * the major is dropped, never guessed. One record per course and term; the last wins.
 */
export function matchRecords(
  records: TranscriptRecordDto[],
  courses: { id: string; code: string }[],
): MatchedRecord[] {
  const idByCode = new Map(courses.map((c) => [normalizeCode(c.code), c.id]));

  const matched = new Map<string, MatchedRecord>();
  for (const record of records) {
    const courseId = idByCode.get(normalizeCode(record.code));
    if (!courseId) continue;

    matched.set(`${courseId}-${record.term}-${record.year}`, {
      courseId,
      status: record.status,
      // An in-progress course has no final grade, whatever the AI read.
      grade: record.status === 'IN_PROGRESS' ? null : record.grade,
      term: record.term,
      year: record.year,
    });
  }
  return [...matched.values()];
}
