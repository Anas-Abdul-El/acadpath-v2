import { matchRecords, normalizeCode } from './transcript-matching.js';

describe('normalizeCode (v1: shared/courses.ts)', () => {
  it.each([
    ['CSCI 250', 'CSCI250'],
    ['csci  250', 'CSCI250'],
    ['Csci250', 'CSCI250'],
  ])('%s → %s', (code, expected) => {
    expect(normalizeCode(code)).toBe(expected);
  });
});

describe('matchRecords (v1: matchRecordsToMajorCourses)', () => {
  const courses = [
    { id: 'c250', code: 'CSCI 250' },
    { id: 'm210', code: 'MATH 210' },
  ];
  const record = {
    code: 'CSCI 250',
    status: 'COMPLETED' as const,
    grade: 'B_PLUS' as const,
    term: 'FALL' as const,
    year: 2024,
  };

  it("links records to the major's courses, whatever the code's spacing or case", () => {
    expect(matchRecords([{ ...record, code: 'csci250' }], courses)).toEqual([
      {
        courseId: 'c250',
        status: 'COMPLETED',
        grade: 'B_PLUS',
        term: 'FALL',
        year: 2024,
      },
    ]);
  });

  it('drops courses that are not in the major, instead of guessing', () => {
    expect(matchRecords([{ ...record, code: 'BIOL 101' }], courses)).toEqual(
      [],
    );
  });

  it('never keeps a grade on an in-progress course', () => {
    const [matched] = matchRecords(
      [{ ...record, status: 'IN_PROGRESS', grade: 'A' }],
      courses,
    );
    expect(matched.grade).toBeNull();
  });

  it('keeps one record per course and term, and a retake in another term separately', () => {
    const matched = matchRecords(
      [
        { ...record, status: 'FAILED', grade: 'F', term: 'FALL', year: 2023 },
        { ...record, term: 'SPRING', year: 2024 },
        { ...record, term: 'SPRING', year: 2024, grade: 'A' },
      ],
      courses,
    );

    expect(matched).toHaveLength(2);
    // The last duplicate wins, as in v1.
    expect(matched[1]).toMatchObject({
      term: 'SPRING',
      year: 2024,
      grade: 'A',
    });
  });
});
