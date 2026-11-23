import { Test } from '@nestjs/testing';
import { UnrecoverableError, type Job } from 'bullmq';
import { AiInvalidResponseError, AiUnavailableError } from '../ai/ai.errors.js';
import { AiService } from '../ai/ai.service.js';
import { StorageService } from '../storage/storage.service.js';
import { makePdf } from '../../test/fixtures/make-pdf.js';
import { fileBytes } from '../../test/fixtures/files.js';
import { TRANSCRIPT_EXTRACTION_PROMPT } from './transcript.prompts.js';
import { TranscriptProcessor } from './transcript.processor.js';
import type { TranscriptJobData } from './transcript.queue.js';
import { TranscriptRepository } from './transcript.repository.js';
import { TranscriptDataDto } from './dto/transcript-data.dto.js';

const data: TranscriptJobData = {
  studentId: 'sp-1',
  documentIds: ['d1', 'd2'],
};
const job = (attempt = 1, attempts = 3) =>
  ({
    data,
    attemptsMade: attempt - 1,
    opts: { attempts },
  }) as unknown as Job<TranscriptJobData>;

const context = {
  universityName: 'Lebanese International University',
  majorId: 'major-cs',
  majorName: 'Computer Science',
  documents: [
    {
      id: 'd1',
      fileName: 'transcript.pdf',
      fileUrl: 'documents/sp-1/a.pdf',
      mimeType: 'application/pdf',
    },
    {
      id: 'd2',
      fileName: 'page2.png',
      fileUrl: 'documents/sp-1/b.png',
      mimeType: 'image/png',
    },
  ],
};

describe('TranscriptProcessor', () => {
  const repo = {
    findJobContext: vi.fn(),
    markProcessing: vi.fn(),
    markFailed: vi.fn(),
    listMajorCourses: vi.fn(),
    replaceAcademicRecords: vi.fn(),
  };
  const storage = { get: vi.fn() };
  const ai = { askForJson: vi.fn() };
  let processor: TranscriptProcessor;

  beforeEach(async () => {
    vi.clearAllMocks();
    repo.findJobContext.mockResolvedValue(context);
    repo.listMajorCourses.mockResolvedValue([{ id: 'c250', code: 'CSCI 250' }]);
    storage.get.mockImplementation((key: string) =>
      Promise.resolve(
        key.endsWith('.pdf')
          ? makePdf('CSCI 250 B+ Fall 2024')
          : fileBytes.png(),
      ),
    );
    ai.askForJson.mockResolvedValue({
      records: [
        {
          code: 'CSCI 250',
          status: 'COMPLETED',
          grade: 'B_PLUS',
          term: 'FALL',
          year: 2024,
        },
        {
          code: 'BIOL 101',
          status: 'COMPLETED',
          grade: 'A',
          term: 'FALL',
          year: 2024,
        },
      ],
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        TranscriptProcessor,
        { provide: TranscriptRepository, useValue: repo },
        { provide: StorageService, useValue: storage },
        { provide: AiService, useValue: ai },
      ],
    }).compile();
    processor = moduleRef.get(TranscriptProcessor);
  });

  it('sends PDF text as documents and images as attachments to the AI', async () => {
    await processor.process(job());

    expect(repo.markProcessing).toHaveBeenCalledWith(['d1', 'd2']);
    const [prompt, payload, dto, options] = ai.askForJson.mock.calls[0] as [
      string,
      { documents: { fileName: string; text: string }[] },
      unknown,
      { attachments: { fileName: string; mimeType: string }[] },
    ];
    expect(prompt).toBe(TRANSCRIPT_EXTRACTION_PROMPT);
    expect(dto).toBe(TranscriptDataDto);
    expect(payload).toMatchObject({
      universityName: 'Lebanese International University',
      majorName: 'Computer Science',
    });
    expect(payload.documents).toEqual([
      { fileName: 'transcript.pdf', text: expect.stringContaining('CSCI 250') },
    ]);
    expect(options.attachments).toEqual([
      expect.objectContaining({ fileName: 'page2.png', mimeType: 'image/png' }),
    ]);
  });

  it("replaces the student's records with the matched ones and completes the documents", async () => {
    await processor.process(job());

    expect(repo.replaceAcademicRecords).toHaveBeenCalledWith(
      'sp-1',
      [
        {
          courseId: 'c250',
          status: 'COMPLETED',
          grade: 'B_PLUS',
          term: 'FALL',
          year: 2024,
        },
      ],
      ['d1', 'd2'],
    );
    expect(repo.markFailed).not.toHaveBeenCalled();
  });

  it('attaches a scanned PDF (valid, but no text layer) for the vision model', async () => {
    storage.get.mockResolvedValue(makePdf(''));
    repo.findJobContext.mockResolvedValue({
      ...context,
      documents: [context.documents[0]],
    });

    await processor.process(job());

    const [, payload, , options] = ai.askForJson.mock.calls[0] as [
      string,
      { documents: unknown[] },
      unknown,
      { attachments: { fileName: string; mimeType: string }[] },
    ];
    expect(payload.documents).toEqual([]);
    expect(options.attachments).toEqual([
      expect.objectContaining({
        fileName: 'transcript.pdf',
        mimeType: 'application/pdf',
      }),
    ]);
  });

  it('fails for good on a corrupt PDF, naming the file', async () => {
    storage.get.mockResolvedValue(Buffer.from('%PDF-garbage'));
    repo.findJobContext.mockResolvedValue({
      ...context,
      documents: [context.documents[0]],
    });

    await expect(processor.process(job())).rejects.toThrow(UnrecoverableError);
    expect(repo.markFailed).toHaveBeenCalledWith(
      ['d1', 'd2'],
      'Could not read transcript.pdf',
    );
    expect(ai.askForJson).not.toHaveBeenCalled();
  });

  it('fails for good when no course matches the major', async () => {
    repo.listMajorCourses.mockResolvedValue([{ id: 'x', code: 'ARTS 100' }]);

    await expect(processor.process(job())).rejects.toThrow(UnrecoverableError);
    expect(repo.markFailed).toHaveBeenCalledWith(
      ['d1', 'd2'],
      'None of the courses in the uploaded files are in Computer Science',
    );
    expect(repo.replaceAcademicRecords).not.toHaveBeenCalled();
  });

  it('fails for good on an invalid AI reply', async () => {
    ai.askForJson.mockRejectedValue(new AiInvalidResponseError());

    await expect(processor.process(job())).rejects.toThrow(UnrecoverableError);
    expect(repo.markFailed).toHaveBeenCalledWith(
      ['d1', 'd2'],
      'The AI returned invalid transcript data',
    );
  });

  it('retries a transient failure, and marks the documents failed only on the last attempt', async () => {
    ai.askForJson.mockRejectedValue(new AiUnavailableError());

    await expect(processor.process(job(1, 3))).rejects.toThrow(
      AiUnavailableError,
    );
    expect(repo.markFailed).not.toHaveBeenCalled();

    await expect(processor.process(job(3, 3))).rejects.toThrow(
      AiUnavailableError,
    );
    expect(repo.markFailed).toHaveBeenCalledWith(
      ['d1', 'd2'],
      'The AI provider failed, try again later',
    );
  });

  it('does nothing when the documents or the selection are gone', async () => {
    repo.findJobContext.mockResolvedValue(null);

    await processor.process(job());

    expect(repo.markProcessing).not.toHaveBeenCalled();
    expect(ai.askForJson).not.toHaveBeenCalled();
  });
});
