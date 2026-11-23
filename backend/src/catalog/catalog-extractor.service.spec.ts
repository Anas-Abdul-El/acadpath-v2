import { Test } from '@nestjs/testing';
import { AiService } from '../ai/ai.service.js';
import { PageReader } from '../web/page-reader.service.js';
import {
  CatalogExtractor,
  UnreadableFileError,
} from './catalog-extractor.service.js';
import {
  COURSE_EXTRACTION_PROMPT,
  IMAGE_EXTRACTION_PROMPT,
  SOURCE_DISCOVERY_PROMPT,
} from './catalog.prompts.js';
import { makePdf } from '../../test/fixtures/make-pdf.js';
import { fileBytes } from '../../test/fixtures/files.js';
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

  describe('extractFromFiles (uploaded catalog sources)', () => {
    const course = (code: string, name: string) => ({
      code,
      name,
      description: null,
      credits: 3,
      category: 'MAJOR_REQUIREMENT',
      offeredTerms: [],
      prerequisites: [],
      corequisites: [],
    });
    const pdf = {
      fileName: 'plan.pdf',
      mimeType: 'application/pdf',
      data: makePdf('CSCI 250 Data Structures 3'),
    };
    const png = {
      fileName: 'page.png',
      mimeType: 'image/png',
      data: fileBytes.png(),
    };

    it('sends PDF text to the course-extraction prompt, without web search', async () => {
      ai.askForJson.mockResolvedValue({ major: null, courses: [] });

      await extractor.extractFromFiles(input, [pdf]);

      expect(ai.askForJson).toHaveBeenCalledOnce();
      expect(ai.askForJson).toHaveBeenCalledWith(
        COURSE_EXTRACTION_PROMPT,
        {
          universityName: 'Lebanese International University',
          majorName: 'Computer Science',
          sources: [
            {
              url: 'plan.pdf',
              type: 'pdf',
              text: expect.stringContaining('CSCI 250'),
            },
          ],
        },
        MajorDataDto,
        { webSearch: false },
      );
    });

    it('sends images, and scanned PDFs, to the image prompt as attachments', async () => {
      ai.askForJson.mockResolvedValue({ major: null, courses: [] });
      const scanned = {
        fileName: 'scan.pdf',
        mimeType: 'application/pdf',
        data: makePdf(''),
      };

      await extractor.extractFromFiles(input, [png, scanned]);

      expect(ai.askForJson).toHaveBeenCalledOnce();
      expect(ai.askForJson).toHaveBeenCalledWith(
        IMAGE_EXTRACTION_PROMPT,
        {
          universityName: 'Lebanese International University',
          majorName: 'Computer Science',
        },
        MajorDataDto,
        {
          attachments: [
            { data: png.data, mimeType: 'image/png', fileName: 'page.png' },
            {
              data: scanned.data,
              mimeType: 'application/pdf',
              fileName: 'scan.pdf',
            },
          ],
        },
      );
    });

    it('merges both results by course code; the PDF wins a duplicate and names the major', async () => {
      ai.askForJson.mockImplementation((prompt: string) =>
        Promise.resolve(
          prompt === COURSE_EXTRACTION_PROMPT
            ? {
                major: { name: 'CS', totalRequiredCredits: 99 },
                courses: [course('CSCI 250', 'From PDF')],
              }
            : {
                major: { name: 'CS (img)', totalRequiredCredits: null },
                courses: [
                  course('CSCI 250', 'From image'),
                  course('MATH 210', 'Calculus'),
                ],
              },
        ),
      );

      const result = await extractor.extractFromFiles(input, [pdf, png]);

      expect(result.major).toEqual({ name: 'CS', totalRequiredCredits: 99 });
      expect(result.courses.map((c) => [c.code, c.name])).toEqual([
        ['CSCI 250', 'From PDF'],
        ['MATH 210', 'Calculus'],
      ]);
    });

    it('reports a corrupt PDF by name, without calling the AI', async () => {
      const corrupt = {
        fileName: 'broken.pdf',
        mimeType: 'application/pdf',
        data: Buffer.from('%PDF-junk'),
      };

      const error: unknown = await extractor
        .extractFromFiles(input, [corrupt])
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(UnreadableFileError);
      expect((error as Error).message).toBe('Could not read broken.pdf');
      expect(ai.askForJson).not.toHaveBeenCalled();
    });
  });
});
