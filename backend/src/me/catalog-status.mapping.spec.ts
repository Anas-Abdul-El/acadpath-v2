import { toCatalogStatus } from './catalog-status.js';

describe('toCatalogStatus (per-major status → what the client sees)', () => {
  it.each([
    ['COMPLETED', 'AVAILABLE'],
    ['PENDING', 'PROCESSING'],
    ['PROCESSING', 'PROCESSING'],
    ['FAILED', 'UNAVAILABLE'],
  ] as const)('%s → %s', (status, expected) => {
    expect(toCatalogStatus(status)).toBe(expected);
  });
});
