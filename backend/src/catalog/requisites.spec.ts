import { buildRequisites } from './requisites.js';

describe('buildRequisites', () => {
  const idByCode = new Map([
    ['CSCI 150', 'c150'],
    ['CSCI 250', 'c250'],
    ['MATH 210', 'm210'],
  ]);

  it('links prerequisites and corequisites by course id', () => {
    expect(
      buildRequisites(
        [
          {
            code: 'CSCI 250',
            prerequisites: ['CSCI 150'],
            corequisites: ['MATH 210'],
          },
        ],
        idByCode,
      ),
    ).toEqual([
      {
        courseId: 'c250',
        requiredCourseId: 'c150',
        relationType: 'PREREQUISITE',
      },
      {
        courseId: 'c250',
        requiredCourseId: 'm210',
        relationType: 'COREQUISITE',
      },
    ]);
  });

  it('skips codes that are not saved courses, and a course requiring itself', () => {
    expect(
      buildRequisites(
        [
          {
            code: 'CSCI 250',
            prerequisites: ['CSCI 999', 'CSCI 250'],
            corequisites: [],
          },
          { code: 'UNKNOWN 1', prerequisites: ['CSCI 150'], corequisites: [] },
        ],
        idByCode,
      ),
    ).toEqual([]);
  });
});
