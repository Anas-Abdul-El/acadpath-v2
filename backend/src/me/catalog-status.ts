import type { ProcessingStatus } from '../generated/prisma/enums.js';

// Ported from v1 services/me/university/catalog-status.ts. Deterministic: the status
// comes only from the timestamps and errors the processing pipeline wrote.

export type CatalogStatus = 'AVAILABLE' | 'PROCESSING' | 'UNAVAILABLE';

export interface SourceState {
  errorMessage: string | null;
  lastProcessedAt: Date | null;
  lastFetchedAt: Date | null;
}

export function getSourceStatus(source: SourceState): ProcessingStatus {
  if (source.errorMessage) return 'FAILED';
  if (source.lastProcessedAt) return 'COMPLETED';
  if (source.lastFetchedAt) return 'PROCESSING';
  return 'PENDING';
}

/** A catalog is usable as soon as one of its sources was processed. */
export function getCatalogStatus(sources: SourceState[]): CatalogStatus {
  const statuses = sources.map(getSourceStatus);
  if (statuses.includes('COMPLETED')) return 'AVAILABLE';
  if (statuses.includes('PENDING') || statuses.includes('PROCESSING')) {
    return 'PROCESSING';
  }
  return 'UNAVAILABLE';
}
