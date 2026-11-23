import { Test } from '@nestjs/testing';
import { PageReader } from './page-reader.service.js';
import { BlockedUrlError } from './safe-fetch.js';
import { makePdf } from '../../test/fixtures/make-pdf.js';
import { WEB_FETCH } from './web.constants.js';

describe('PageReader', () => {
  const fetch = vi.fn();
  let reader: PageReader;

  beforeEach(async () => {
    vi.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [PageReader, { provide: WEB_FETCH, useValue: fetch }],
    }).compile();
    reader = moduleRef.get(PageReader);
  });

  const page = (
    contentType: string,
    body: Buffer | string,
    url = 'https://liu.edu.lb/cs',
  ) => ({
    url,
    contentType,
    body: Buffer.isBuffer(body) ? body : Buffer.from(body),
  });

  it('reads an HTML page as clean text', async () => {
    fetch.mockResolvedValue(
      page(
        'text/html; charset=utf-8',
        '<h1>CS</h1><script>x()</script><p>CSCI 250</p>',
      ),
    );

    await expect(reader.read('https://liu.edu.lb/cs')).resolves.toEqual({
      url: 'https://liu.edu.lb/cs',
      type: 'html',
      text: 'CS\n\nCSCI 250',
    });
  });

  it('reads a PDF', async () => {
    fetch.mockResolvedValue(
      page('application/pdf', makePdf('CSCI 250 Data Structures 3')),
    );

    const result = await reader.read('https://liu.edu.lb/catalog.pdf');

    expect(result?.type).toBe('pdf');
    expect(result?.text).toContain('CSCI 250 Data Structures 3');
  });

  it('recognises a PDF served with the wrong content type', async () => {
    fetch.mockResolvedValue(page('application/octet-stream', makePdf('Hello')));

    expect((await reader.read('https://liu.edu.lb/x'))?.type).toBe('pdf');
  });

  it('reports the URL it ended at after redirects', async () => {
    fetch.mockResolvedValue(
      page('text/html', '<p>Hi</p>', 'https://liu.edu.lb/final'),
    );

    expect((await reader.read('https://liu.edu.lb/start'))?.url).toBe(
      'https://liu.edu.lb/final',
    );
  });

  it.each([
    [
      'an unsupported content type',
      () => fetch.mockResolvedValue(page('image/png', 'png')),
    ],
    [
      'an empty page',
      () => fetch.mockResolvedValue(page('text/html', '<script>x</script>')),
    ],
    [
      'a blocked URL',
      () => fetch.mockRejectedValue(new BlockedUrlError('private')),
    ],
    ['a network error', () => fetch.mockRejectedValue(new Error('ECONNRESET'))],
    [
      'a PDF that cannot be parsed',
      () => fetch.mockResolvedValue(page('application/pdf', '%PDF-garbage')),
    ],
  ])(
    'returns null for %s, so one bad source never fails the rest',
    async (_case, arrange) => {
      arrange();

      await expect(reader.read('https://liu.edu.lb/x')).resolves.toBeNull();
    },
  );
});
