import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MajorDataDto } from './major-data.dto.js';

/** Same checks AiService runs on a reply. */
async function check(json: unknown) {
  const instance = plainToInstance(MajorDataDto, json);
  const errors = await validate(instance, {
    whitelist: true,
    forbidUnknownValues: true,
  });
  return { instance, valid: errors.length === 0 };
}

const course = {
  code: 'CSCI 250',
  name: 'Data Structures',
  description: null,
  credits: 3,
  category: 'MAJOR_REQUIREMENT',
  offeredTerms: ['FALL'],
  prerequisites: ['CSCI 150'],
  corequisites: [],
};

describe('MajorDataDto (the course-extraction AI reply)', () => {
  it('accepts a well-formed reply', async () => {
    const { valid } = await check({
      major: { name: 'Computer Science', totalRequiredCredits: 99 },
      courses: [course],
    });
    expect(valid).toBe(true);
  });

  it('accepts "nothing found": major null and no courses', async () => {
    expect((await check({ major: null, courses: [] })).valid).toBe(true);
  });

  it('defaults a missing offeredTerms to [] (as v1 did)', async () => {
    const { offeredTerms: _, ...withoutTerms } = course;
    const { instance, valid } = await check({
      major: null,
      courses: [withoutTerms],
    });

    expect(valid).toBe(true);
    expect(instance.courses[0].offeredTerms).toEqual([]);
  });

  it.each([
    ['missing courses', { major: null }],
    ['missing major key', { courses: [] }],
    [
      'credits as text',
      { major: null, courses: [{ ...course, credits: '3' }] },
    ],
    [
      'negative credits',
      { major: null, courses: [{ ...course, credits: -1 }] },
    ],
    [
      'an unknown category',
      { major: null, courses: [{ ...course, category: 'CORE' }] },
    ],
    [
      'an unknown term',
      { major: null, courses: [{ ...course, offeredTerms: ['WINTER'] }] },
    ],
    ['an empty code', { major: null, courses: [{ ...course, code: '' }] }],
    [
      'a missing description key',
      { major: null, courses: [{ ...course, description: undefined }] },
    ],
    [
      'total credits over 300',
      { major: { name: 'CS', totalRequiredCredits: 301 }, courses: [] },
    ],
    [
      'a major without a name',
      { major: { totalRequiredCredits: 99 }, courses: [] },
    ],
  ])('rejects %s', async (_case, json) => {
    expect((await check(json)).valid).toBe(false);
  });
});
