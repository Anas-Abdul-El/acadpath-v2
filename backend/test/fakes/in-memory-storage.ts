import { randomUUID } from 'node:crypto';
import type { StorageService } from '../../src/storage/storage.service.js';

/** Stands in for StorageService: objects in a Map, keys built like the real service. */
export class InMemoryStorage implements Pick<
  StorageService,
  keyof StorageService
> {
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();
  /** Set to make the next put() fail, like an S3 outage. */
  failPuts = false;

  newKey(
    folder: 'documents' | 'sources',
    ownerId: string,
    contentType: string,
  ): string {
    const ext =
      { 'application/pdf': 'pdf', 'image/png': 'png' }[contentType] ?? 'bin';
    return `${folder}/${ownerId}/${randomUUID()}.${ext}`;
  }

  put(key: string, body: Buffer, contentType: string): Promise<void> {
    if (this.failPuts) return Promise.reject(new Error('S3 unavailable'));
    this.objects.set(key, { body, contentType });
    return Promise.resolve();
  }

  get(key: string): Promise<Buffer> {
    const object = this.objects.get(key);
    return object
      ? Promise.resolve(object.body)
      : Promise.reject(new Error(`No object ${key}`));
  }

  delete(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }
}
