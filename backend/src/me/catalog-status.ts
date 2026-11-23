import type { ProcessingStatus } from '../generated/prisma/enums.js';

/** What the client sees about a major's course catalog. */
export type CatalogStatus = 'AVAILABLE' | 'PROCESSING' | 'UNAVAILABLE';

/**
 * Maps the major's extraction status (Major.catalogStatus, set by the catalog worker)
 * to what the client sees. v1 worked this out per university, from its sources, so a
 * new major showed AVAILABLE when another major at the same university had data.
 */
export function toCatalogStatus(status: ProcessingStatus): CatalogStatus {
  switch (status) {
    case 'COMPLETED':
      return 'AVAILABLE';
    case 'PENDING':
    case 'PROCESSING':
      return 'PROCESSING';
    case 'FAILED':
      return 'UNAVAILABLE';
  }
}

export interface SourceState {
  errorMessage: string | null;
  lastProcessedAt: Date | null;
  lastFetchedAt: Date | null;
}

/** The processing state of one catalog source (v1: getSourceStatus). */
export function getSourceStatus(source: SourceState): ProcessingStatus {
  if (source.errorMessage) return 'FAILED';
  if (source.lastProcessedAt) return 'COMPLETED';
  if (source.lastFetchedAt) return 'PROCESSING';
  return 'PENDING';
}
