import { Injectable } from '@nestjs/common';
import { AiService, type AiAttachment } from '../ai/ai.service.js';
import { PageReader, type ReadPage } from '../web/page-reader.service.js';
import { pdfToText } from '../web/pdf-to-text.js';
import {
  COURSE_EXTRACTION_PROMPT,
  IMAGE_EXTRACTION_PROMPT,
  SOURCE_DISCOVERY_PROMPT,
} from './catalog.prompts.js';
import type { CatalogJobData } from './catalog.queue.js';
import { MajorDataDto } from './dto/major-data.dto.js';
import { SourcesDto } from './dto/sources.dto.js';

/** The prompt asks for at most 5; the server enforces it, since each one is fetched. */
const MAX_SOURCES = 5;

type MajorInput = Pick<
  CatalogJobData,
  'universityName' | 'city' | 'country' | 'majorName'
>;

/** An uploaded catalog file, read back from storage. */
export interface CatalogFile {
  fileName: string;
  mimeType: string;
  data: Buffer;
}

/** A PDF that pdf.js can't open. Retrying won't help, so the upload fails at once. */
export class UnreadableFileError extends Error {
  constructor(fileName: string) {
    super(`Could not read ${fileName}`);
    this.name = 'UnreadableFileError';
  }
}

const NOTHING_FOUND = (): MajorDataDto => ({ major: null, courses: [] });

/**
 * The three steps of catalog extraction (v1: services/me/university/catalog-extraction.ts):
 * find official pages with AI web search, read them safely, extract the courses with AI.
 */
@Injectable()
export class CatalogExtractor {
  constructor(
    private readonly ai: AiService,
    private readonly reader: PageReader,
  ) {}

  async findSources(input: MajorInput): Promise<string[]> {
    const { sources } = await this.ai.askForJson(
      SOURCE_DISCOVERY_PROMPT,
      {
        universityName: input.universityName.trim(),
        universityCity: input.city.trim(),
        universityCountry: input.country.trim(),
        majorName: input.majorName.trim(),
      },
      SourcesDto,
      { webSearch: true },
    );
    return [...new Set(sources)].slice(0, MAX_SOURCES);
  }

  async readSources(urls: string[]): Promise<ReadPage[]> {
    const pages = await Promise.all(urls.map((url) => this.reader.read(url)));
    return pages.filter((page): page is ReadPage => page !== null);
  }

  /**
   * Web search is off here (it was on in v1): the prompt says to use only the source
   * text, and searching would let the model bring in outside information.
   */
  async extractMajorData(
    input: MajorInput,
    pages: ReadPage[],
  ): Promise<MajorDataDto> {
    if (pages.length === 0) return { major: null, courses: [] };

    return this.ai.askForJson(
      COURSE_EXTRACTION_PROMPT,
      {
        universityName: input.universityName.trim(),
        majorName: input.majorName.trim(),
        sources: pages,
      },
      MajorDataDto,
      { webSearch: false },
    );
  }

  /**
   * Extracts a major from files a student uploaded (v1: extractMajorDataFromFiles).
   * Text PDFs go to the course-extraction prompt; images and scanned PDFs go to the
   * image prompt as attachments. Both results are merged by course code, the PDF
   * version winning a duplicate, and the major's details come from the PDFs first.
   */
  async extractFromFiles(
    input: MajorInput,
    files: CatalogFile[],
  ): Promise<MajorDataDto> {
    const pages: ReadPage[] = [];
    const attachments: AiAttachment[] = [];

    for (const file of files) {
      if (file.mimeType === 'application/pdf') {
        let text: string;
        try {
          text = await pdfToText(file.data);
        } catch {
          throw new UnreadableFileError(file.fileName);
        }
        if (text.length > 0) {
          pages.push({ url: file.fileName, type: 'pdf', text });
          continue;
        }
      }
      attachments.push({
        data: file.data,
        mimeType: file.mimeType,
        fileName: file.fileName,
      });
    }

    const [fromPdfs, fromImages] = await Promise.all([
      pages.length > 0 ? this.extractMajorData(input, pages) : NOTHING_FOUND(),
      attachments.length > 0
        ? this.ai.askForJson(
            IMAGE_EXTRACTION_PROMPT,
            {
              universityName: input.universityName.trim(),
              majorName: input.majorName.trim(),
            },
            MajorDataDto,
            { attachments },
          )
        : NOTHING_FOUND(),
    ]);

    const courses = new Map(
      [...fromImages.courses, ...fromPdfs.courses].map((course) => [
        course.code,
        course,
      ]),
    );
    return {
      major: fromPdfs.major ?? fromImages.major,
      courses: [...courses.values()],
    };
  }
}
