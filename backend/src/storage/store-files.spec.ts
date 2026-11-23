import { ServiceUnavailableException } from '@nestjs/common';
import { InMemoryStorage } from '../../test/fakes/in-memory-storage.js';
import { fileBytes } from '../../test/fixtures/files.js';
import type { ValidatedFile } from '../common/uploads/uploaded-files.pipe.js';
import { storeFiles } from './store-files.js';

const file = (name: string): ValidatedFile => ({
  originalName: name,
  size: 73,
  buffer: fileBytes.pdf(),
  kind: 'PDF',
  mimeType: 'application/pdf',
});

describe('storeFiles', () => {
  it('stores every file under a new key and returns them in order', async () => {
    const storage = new InMemoryStorage();

    const stored = await storeFiles(storage, 'sources', 'uni-1', [
      file('a.pdf'),
      file('b.pdf'),
    ]);

    expect(stored.map((s) => s.file.originalName)).toEqual(['a.pdf', 'b.pdf']);
    expect(stored.every((s) => storage.objects.has(s.key))).toBe(true);
    expect(stored[0].key).toMatch(/^sources\/uni-1\//);
  });

  it('stores all or nothing: a failure removes what was stored, then answers 503', async () => {
    const storage = new InMemoryStorage();
    vi.spyOn(storage, 'put')
      .mockImplementationOnce((key, body, type) => {
        storage.objects.set(key, { body, contentType: type });
        return Promise.resolve();
      })
      .mockRejectedValueOnce(new Error('S3 down'));

    await expect(
      storeFiles(storage, 'sources', 'uni-1', [file('a.pdf'), file('b.pdf')]),
    ).rejects.toThrow(ServiceUnavailableException);
    expect(storage.objects.size).toBe(0);
  });
});
