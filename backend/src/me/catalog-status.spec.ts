import { getSourceStatus } from './catalog-status.js';

const source = (state: {
  errorMessage?: string;
  lastProcessedAt?: Date;
  lastFetchedAt?: Date;
}) => ({
  errorMessage: state.errorMessage ?? null,
  lastProcessedAt: state.lastProcessedAt ?? null,
  lastFetchedAt: state.lastFetchedAt ?? null,
});
const now = new Date();

describe('getSourceStatus', () => {
  it.each([
    [
      'FAILED when it has an error',
      source({ errorMessage: 'x', lastProcessedAt: now }),
      'FAILED',
    ],
    [
      'COMPLETED once processed',
      source({ lastProcessedAt: now, lastFetchedAt: now }),
      'COMPLETED',
    ],
    ['PROCESSING once fetched', source({ lastFetchedAt: now }), 'PROCESSING'],
    ['PENDING before anything', source({}), 'PENDING'],
  ])('is %s', (_case, input, expected) => {
    expect(getSourceStatus(input)).toBe(expected);
  });
});
