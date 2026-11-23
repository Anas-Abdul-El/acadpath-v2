import { Logger, ServiceUnavailableException } from '@nestjs/common';
import type { ValidatedFile } from '../common/uploads/uploaded-files.pipe.js';
import type { StorageService } from './storage.service.js';

const logger = new Logger('storeFiles');

/**
 * Stores uploaded files, all or none: if one fails, those already stored are removed
 * and the request gets a 503. Shared by document and catalog-source uploads.
 */
export async function storeFiles(
  storage: Pick<StorageService, 'newKey' | 'put' | 'delete'>,
  folder: 'documents' | 'sources',
  ownerId: string,
  files: ValidatedFile[],
): Promise<{ file: ValidatedFile; key: string }[]> {
  const stored: { file: ValidatedFile; key: string }[] = [];
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
