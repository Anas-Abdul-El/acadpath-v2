import { HttpException } from '@nestjs/common';
import { fileBytes } from '../../../test/fixtures/files.js';
import { UploadedFilesPipe } from './uploaded-files.pipe.js';

/** A file as multer (memory storage) hands it over. */
const upload = (
  buffer: Buffer,
  name = 'transcript.pdf',
  mimetype = 'application/pdf',
) =>
  ({
    originalname: name,
    mimetype,
    size: buffer.length,
    buffer,
  }) as Express.Multer.File;

/** Runs the pipe and returns the HTTP error it threw. */
function rejection(pipe: UploadedFilesPipe, files: unknown) {
  try {
    pipe.transform(files);
  } catch (error) {
    if (error instanceof HttpException) {
      return { status: error.getStatus(), body: error.getResponse() };
    }
    throw error;
  }
  throw new Error('Expected the pipe to reject');
}

describe('UploadedFilesPipe', () => {
  const pipe = new UploadedFilesPipe();

  it('returns each file with the type detected from its bytes', () => {
    const files = pipe.transform([
      upload(fileBytes.pdf(), 'a.pdf'),
      // Declared as a PDF, but the bytes are a PNG: the bytes win.
      upload(fileBytes.png(), 'b.pdf', 'application/pdf'),
    ]);

    expect(files).toEqual([
      {
        originalName: 'a.pdf',
        size: 73,
        buffer: expect.any(Buffer),
        kind: 'PDF',
        mimeType: 'application/pdf',
      },
      {
        originalName: 'b.pdf',
        size: 72,
        buffer: expect.any(Buffer),
        kind: 'IMAGE',
        mimeType: 'image/png',
      },
    ]);
  });

  it.each([
    ['no files', undefined],
    ['an empty list', []],
  ])('rejects %s', (_case, files) => {
    expect(rejection(pipe, files)).toEqual({
      status: 400,
      body: {
        message: 'Validation failed',
        details: [{ path: 'files', message: 'Upload at least one file' }],
      },
    });
  });

  it('rejects an empty file', () => {
    expect(
      rejection(pipe, [upload(fileBytes.pdf()), upload(Buffer.alloc(0))]),
    ).toEqual({
      status: 400,
      body: {
        message: 'Validation failed',
        details: [{ path: '1.size', message: 'File is empty' }],
      },
    });
  });

  it('rejects a file whose bytes are not a PDF or image with 400 by default', () => {
    expect(rejection(pipe, [upload(fileBytes.exe(), 'evil.pdf')])).toEqual({
      status: 400,
      body: {
        message: 'Validation failed',
        details: [
          { path: '0', message: 'File must be a PDF, PNG, JPEG or WebP' },
        ],
      },
    });
  });

  it('uses the status it is configured with for an unsupported type (415 for documents)', () => {
    expect(
      rejection(new UploadedFilesPipe({ unsupportedTypeStatus: 415 }), [
        upload(fileBytes.exe()),
      ]).status,
    ).toBe(415);
  });

  it('rejects more than 150 MB in total with 413', () => {
    const big = (name: string) =>
      ({
        originalname: name,
        mimetype: 'application/pdf',
        size: 25 * 1024 * 1024,
        buffer: fileBytes.pdf(),
      }) as Express.Multer.File;
    const files = Array.from({ length: 7 }, (_, i) => big(`${i}.pdf`));

    expect(rejection(pipe, files)).toEqual({
      status: 413,
      body: {
        message: 'Validation failed',
        details: [
          { path: '', message: 'Files must be 150 MB or smaller in total' },
        ],
      },
    });
  });

  it('reports every problem at once, with the most specific status', () => {
    const result = rejection(
      new UploadedFilesPipe({ unsupportedTypeStatus: 415 }),
      [upload(Buffer.alloc(0)), upload(fileBytes.exe())],
    );
    expect(result.status).toBe(415);
    expect(result.body).toMatchObject({
      details: [
        { path: '0.size', message: 'File is empty' },
        { path: '1', message: 'File must be a PDF, PNG, JPEG or WebP' },
      ],
    });
  });
});
