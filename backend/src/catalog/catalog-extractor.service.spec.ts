import { Test } from '@nestjs/testing';
import { AiService } from '../ai/ai.service.js';
import { PageReader } from '../web/page-reader.service.js';
import { CatalogExtractor } from './catalog-extractor.service.js';
import {
  COURSE_EXTRACTION_PROMPT,
  SOURCE_DISCOVERY_PROMPT,
} from './catalog.prompts.js';
import { MajorDataDto } from './dto/major-data.dto.js';
import { SourcesDto } from './dto/sources.dto.js';

const input = {
  universityName: ' Lebanese International University ',
  city: 'Beirut',
  country: 'Lebanon',
  majorName: ' Computer Science ',
};

describe('CatalogExtractor', () => {
  const ai = { askForJson: vi.fn() };
  const reader = { read: vi.fn() };
  let extractor: CatalogExtractor;

  beforeEach(async () => {
    vi.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        CatalogExtractor,
        { provide: AiService, useValue: ai },
        { provide: PageReader, useValue: reader },
      ],
    }).compile();
    extractor = moduleRef.get(CatalogExtractor);
  });

  describe('findSources', () => {
    it('asks the AI, with web search, for sources about the major', async () => {
      ai.askForJson.mockResolvedValue({ sources: [] });

      await extractor.findSources(input);

      expect(ai.askForJson).toHaveBeenCalledWith(
        SOURCE_DISCOVERY_PROMPT,
        {
          universityName: 'Lebanese International University',
          universityCity: 'Beirut',
          universityCountry: 'Lebanon',
          majorName: 'Computer Science',
        },
        SourcesDto,
        { webSearch: true },
      );
    });

    it('keeps at most 5 distinct URLs', async () => {
      ai.askForJson.mockResolvedValue({
        sources: [
          'https://liu.edu.lb/a',
          'https://liu.edu.lb/a',
          'https://liu.edu.lb/b',
          'https://liu.edu.lb/c',
          'https://liu.edu.lb/d',
          'https://liu.edu.lb/e',
          'https://liu.edu.lb/f',
        ],
      });

      await expect(extractor.findSources(input)).resolves.toEqual([
        'https://liu.edu.lb/a',
        'https://liu.edu.lb/b',
        'https://liu.edu.lb/c',
        'https://liu.edu.lb/d',
        'https://liu.edu.lb/e',
      ]);
    });
  });

  describe('readSources', () => {
    it('reads every URL and keeps only the pages that worked', async () => {
      const page = {
        url: 'https://liu.edu.lb/a',
        type: 'html',
        text: 'CSCI 250',
      };
      reader.read.mockResolvedValueOnce(page).mockResolvedValueOnce(null);

      await expect(
        extractor.readSources(['https://liu.edu.lb/a', 'https://liu.edu.lb/b']),
      ).resolves.toEqual([page]);
    });
  });

  describe('extractMajorData', () => {
    it('returns "nothing found" without calling the AI when no page was readable', async () => {
      await expect(extractor.extractMajorData(input, [])).resolves.toEqual({
        major: null,
        courses: [],
      });
      expect(ai.askForJson).not.toHaveBeenCalled();
    });

    it('sends the page text to the AI without web search, so it only uses the sources', async () => {
      const pages = [
        {
          url: 'https://liu.edu.lb/a',
          type: 'html' as const,
          text: 'CSCI 250',
        },
      ];
      const reply = { major: null, courses: [] };
      ai.askForJson.mockResolvedValue(reply);

      await expect(extractor.extractMajorData(input, pages)).resolves.toBe(
        reply,
      );
      expect(ai.askForJson).toHaveBeenCalledWith(
        COURSE_EXTRACTION_PROMPT,
        {
          universityName: 'Lebanese International University',
          majorName: 'Computer Science',
          sources: pages,
        },
        MajorDataDto,
        { webSearch: false },
      );
    });
  });
});
