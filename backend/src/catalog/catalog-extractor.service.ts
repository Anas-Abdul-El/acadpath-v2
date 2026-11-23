import { Injectable } from '@nestjs/common';
import { AiService } from '../ai/ai.service.js';
import { PageReader, type ReadPage } from '../web/page-reader.service.js';
import {
  COURSE_EXTRACTION_PROMPT,
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
}
