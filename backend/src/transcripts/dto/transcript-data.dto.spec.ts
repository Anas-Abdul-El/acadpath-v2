import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { TranscriptDataDto } from './transcript-data.dto.js';

const record = {
  code: 'CSCI 250',
  status: 'COMPLETED',
  grade: 'B_PLUS',
  term: 'FALL',
  year: 2024,
};

async function isValid(json: unknown) {
  const errors = await validate(plainToInstance(TranscriptDataDto, json), {
    whitelist: true,
    forbidUnknownValues: true,
  });
  return errors.length === 0;
}

describe('TranscriptDataDto (the transcript-extraction AI reply)', () => {
  it('accepts well-formed records, and none', async () => {
    expect(await isValid({ records: [record] })).toBe(true);
    expect(await isValid({ records: [] })).toBe(true);
  });

  it('accepts a null grade (in progress, pass/fail)', async () => {
    expect(
      await isValid({
        records: [{ ...record, status: 'IN_PROGRESS', grade: null }],
      }),
    ).toBe(true);
  });

  it.each([
    ['missing records', {}],
    ['a grade outside the scale', { records: [{ ...record, grade: 'A+' }] }],
    ['an unknown status', { records: [{ ...record, status: 'PASSED' }] }],
    ['an unknown term', { records: [{ ...record, term: 'WINTER' }] }],
    ['a year before 1950', { records: [{ ...record, year: 1949 }] }],
    ['a year as text', { records: [{ ...record, year: '2024' }] }],
    ['an empty code', { records: [{ ...record, code: '' }] }],
    ['a missing grade key', { records: [{ ...record, grade: undefined }] }],
  ])('rejects %s', async (_case, json) => {
    expect(await isValid(json)).toBe(false);
  });
});
