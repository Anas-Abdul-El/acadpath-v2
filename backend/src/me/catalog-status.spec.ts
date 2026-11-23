import { getCatalogStatus, getSourceStatus } from './catalog-status.js';

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

describe('getCatalogStatus', () => {
  it('is AVAILABLE when any source completed, even if others failed', () => {
    expect(
      getCatalogStatus([
        source({ errorMessage: 'x' }),
        source({ lastProcessedAt: now }),
      ]),
    ).toBe('AVAILABLE');
  });

  it('is PROCESSING while a source is pending or being processed', () => {
    expect(getCatalogStatus([source({ errorMessage: 'x' }), source({})])).toBe(
      'PROCESSING',
    );
    expect(getCatalogStatus([source({ lastFetchedAt: now })])).toBe(
      'PROCESSING',
    );
  });

  it('is UNAVAILABLE when every source failed or there are none', () => {
    expect(getCatalogStatus([source({ errorMessage: 'x' })])).toBe(
      'UNAVAILABLE',
    );
    expect(getCatalogStatus([])).toBe('UNAVAILABLE');
  });
});
