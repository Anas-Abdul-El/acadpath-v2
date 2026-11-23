import { PDFParse } from 'pdf-parse';

const normalizeText = (text: string): string =>
  text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/**
 * Extracts the plain text of a PDF held in memory (v1: utils/pdfParser.ts).
 * Only buffers: v2 never hands pdf-parse a URL, because its own downloader would skip
 * the SSRF checks in fetchPublicUrl.
 */
export async function pdfToText(buffer: Buffer): Promise<string> {
  // pdf.js takes ownership of the array it receives, which would break the caller's
  // Buffer (and other Buffers sharing its memory). Give it a copy.
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    // Empty pageJoiner drops the "-- 1 of 3 --" markers pdf-parse adds per page.
    const result = await parser.getText({ pageJoiner: '' });
    return normalizeText(result.text);
  } finally {
    await parser.destroy();
  }
}
