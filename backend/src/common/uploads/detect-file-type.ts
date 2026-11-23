export interface DetectedType {
  kind: 'PDF' | 'IMAGE';
  mimeType: 'application/pdf' | 'image/png' | 'image/jpeg' | 'image/webp';
}

const signature = (buffer: Buffer, start: number, end: number): string =>
  buffer.subarray(start, end).toString('latin1');

/**
 * Detects a PDF or image from its first bytes (its "magic number"), so a renamed
 * executable can't pass as a PDF. The file name and the type the client declared are
 * never trusted (v1: detectSourceType).
 */
export function detectFileType(buffer: Buffer): DetectedType | null {
  if (signature(buffer, 0, 4) === '%PDF') {
    return { kind: 'PDF', mimeType: 'application/pdf' };
  }
  if (signature(buffer, 0, 8) === '\x89PNG\r\n\x1a\n') {
    return { kind: 'IMAGE', mimeType: 'image/png' };
  }
  if (signature(buffer, 0, 3) === '\xff\xd8\xff') {
    return { kind: 'IMAGE', mimeType: 'image/jpeg' };
  }
  if (
    signature(buffer, 0, 4) === 'RIFF' &&
    signature(buffer, 8, 12) === 'WEBP'
  ) {
    return { kind: 'IMAGE', mimeType: 'image/webp' };
  }
  return null;
}
