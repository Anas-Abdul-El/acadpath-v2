import { Logger, ServiceUnavailableException } from '@nestjs/common';
import type { StorageService } from './storage.service.js';

const logger = new Logger('storeFiles');

/** A file to store: an upload (ValidatedFile) or a page captured from the portal. */
export interface FileInput {
  /** Shown back to the user; never part of the storage key. */
  originalName: string;
  buffer: Buffer;
  /** Detected by the server (from the bytes, or from where the file came from). */
  mimeType: string;
  size: number;
}

/**
 * Stores uploaded files, all or none: if one fails, those already stored are removed
 * and the request gets a 503. Shared by document and catalog-source uploads.
 */
export async function storeFiles<T extends FileInput>(
  storage: Pick<StorageService, 'newKey' | 'put' | 'delete'>,
  folder: 'documents' | 'sources',
  ownerId: string,
  files: T[],
): Promise<{ file: T; key: string }[]> {
  const stored: { file: T; key: string }[] = [];
  try {
    for (const file of files) {
      const key = storage.newKey(folder, ownerId, file.mimeType);
      await storage.put(key, file.buffer, file.mimeType);
      stored.push({ file, key });
    }
    return stored;
  } catch (error) {
    logger.error('Could not store uploaded files', error);
    await Promise.allSettled(stored.map(({ key }) => storage.delete(key)));
    throw new ServiceUnavailableException(
      'File storage is unavailable, try again later',
    );
  }
}
