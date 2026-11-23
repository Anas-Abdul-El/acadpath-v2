import { fileBytes } from '../../../test/fixtures/files.js';
import { detectFileType } from './detect-file-type.js';

describe('detectFileType (from the bytes, never the name or the declared type)', () => {
  it.each([
    ['a PDF', fileBytes.pdf(), { kind: 'PDF', mimeType: 'application/pdf' }],
    ['a PNG', fileBytes.png(), { kind: 'IMAGE', mimeType: 'image/png' }],
    ['a JPEG', fileBytes.jpeg(), { kind: 'IMAGE', mimeType: 'image/jpeg' }],
    ['a WebP', fileBytes.webp(), { kind: 'IMAGE', mimeType: 'image/webp' }],
  ])('recognises %s', (_case, bytes, expected) => {
    expect(detectFileType(bytes)).toEqual(expected);
  });

  it.each([
    ['an executable', fileBytes.exe()],
    ['text', Buffer.from('hello')],
    ['an empty buffer', Buffer.alloc(0)],
    [
      'RIFF that is not WebP',
      Buffer.concat([
        Buffer.from('RIFF'),
        Buffer.alloc(4),
        Buffer.from('WAVE'),
      ]),
    ],
  ])('returns null for %s', (_case, bytes) => {
    expect(detectFileType(bytes)).toBeNull();
  });
});
