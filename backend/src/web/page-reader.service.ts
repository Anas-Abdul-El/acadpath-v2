import { Inject, Injectable, Logger } from '@nestjs/common';
import { htmlToText } from './html-to-text.js';
import { pdfToText } from './pdf-to-text.js';
import { WEB_FETCH, type WebFetch } from './web.constants.js';

/** A web page or PDF turned into text. The text is untrusted data, never instructions. */
export interface ReadPage {
  url: string;
  type: 'pdf' | 'html';
  text: string;
}

const isPdf = (contentType: string, body: Buffer) =>
  contentType.includes('application/pdf') ||
  body.subarray(0, 5).toString('latin1') === '%PDF-';

/**
 * Fetches a URL safely and returns its text (v1: detectContentType + scraper +
 * pdfParser). One GET per URL: the type comes from the real response, not a separate
 * probe request as in v1.
 */
@Injectable()
export class PageReader {
  private readonly logger = new Logger(PageReader.name);

  constructor(@Inject(WEB_FETCH) private readonly fetch: WebFetch) {}

  /** Returns null when the page can't be used, so one bad source never fails the rest. */
  async read(url: string): Promise<ReadPage | null> {
    try {
      const page = await this.fetch(url);

      let result: ReadPage | null = null;
      if (isPdf(page.contentType, page.body)) {
        result = {
          url: page.url,
          type: 'pdf',
          text: await pdfToText(page.body),
        };
      } else if (page.contentType.includes('text/html')) {
        result = {
          url: page.url,
          type: 'html',
          text: htmlToText(page.body.toString('utf8')),
        };
      }

      return result && result.text.length > 0 ? result : null;
    } catch (error) {
      // The reason only: never the page contents.
      this.logger.warn(
        `Skipped ${url}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }
}
