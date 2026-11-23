import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { S3_CLIENT } from './storage.constants.js';
import { StorageService } from './storage.service.js';

describe('StorageService', () => {
  // The S3 client, mocked: no request leaves the test.
  const s3 = { send: vi.fn() };
  let storage: StorageService;

  beforeEach(async () => {
    vi.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        StorageService,
        { provide: S3_CLIENT, useValue: s3 },
        {
          provide: ConfigService,
          useValue: new ConfigService({ S3_BUCKET: 'uploads' }),
        },
      ],
    }).compile();
    storage = moduleRef.get(StorageService);
  });

  describe('newKey', () => {
    it('builds a server-side key: folder, owner id, random id, extension of the type', () => {
      const key = storage.newKey('documents', 'student-1', 'application/pdf');

      expect(key).toMatch(/^documents\/student-1\/[0-9a-f-]{36}\.pdf$/);
      expect(
        storage.newKey('documents', 'student-1', 'application/pdf'),
      ).not.toBe(key);
    });

    it.each([
      ['image/png', 'png'],
      ['image/jpeg', 'jpg'],
      ['image/webp', 'webp'],
      ['text/html', 'html'],
      ['application/x-unknown', 'bin'],
    ])('uses the extension for %s', (type, ext) => {
      expect(storage.newKey('sources', 'u1', type).endsWith(`.${ext}`)).toBe(
        true,
      );
    });

    it('refuses an owner id that could change the path', () => {
      expect(() =>
        storage.newKey('documents', '../other', 'image/png'),
      ).toThrow();
      expect(() => storage.newKey('documents', 'a/b', 'image/png')).toThrow();
    });
  });

  it('puts a file in the configured bucket with its content type', async () => {
    const body = Buffer.from('%PDF-1.4');

    await storage.put('documents/s/x.pdf', body, 'application/pdf');

    const [command] = s3.send.mock.calls[0] as [PutObjectCommand];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toEqual({
      Bucket: 'uploads',
      Key: 'documents/s/x.pdf',
      Body: body,
      ContentType: 'application/pdf',
    });
  });

  it('reads a file back as a Buffer', async () => {
    s3.send.mockResolvedValue({
      Body: {
        transformToByteArray: () => Promise.resolve(new Uint8Array([1, 2, 3])),
      },
    });

    const data = await storage.get('documents/s/x.pdf');

    const [command] = s3.send.mock.calls[0] as [GetObjectCommand];
    expect(command).toBeInstanceOf(GetObjectCommand);
    expect(command.input).toEqual({
      Bucket: 'uploads',
      Key: 'documents/s/x.pdf',
    });
    expect(Buffer.isBuffer(data)).toBe(true);
    expect([...data]).toEqual([1, 2, 3]);
  });

  it('fails clearly when the object has no body', async () => {
    s3.send.mockResolvedValue({});

    await expect(storage.get('missing')).rejects.toThrow(
      'Empty object: missing',
    );
  });

  it('deletes a file', async () => {
    await storage.delete('documents/s/x.pdf');

    const [command] = s3.send.mock.calls[0] as [DeleteObjectCommand];
    expect(command).toBeInstanceOf(DeleteObjectCommand);
    expect(command.input).toEqual({
      Bucket: 'uploads',
      Key: 'documents/s/x.pdf',
    });
  });
});
