import { Test } from '@nestjs/testing';
import {
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  ProcessingStatus,
  StudentDocumentType,
} from '../../generated/prisma/enums.js';
import { StorageService } from '../../storage/storage.service.js';
import { TranscriptQueue } from '../../transcripts/transcript.queue.js';
import { fileBytes } from '../../../test/fixtures/files.js';
import { InMemoryStorage } from '../../../test/fakes/in-memory-storage.js';
import type { ValidatedFile } from '../../common/uploads/uploaded-files.pipe.js';
import { DocumentsRepository } from './documents.repository.js';
import { DocumentsService } from './documents.service.js';

const pdf: ValidatedFile = {
  originalName: 'transcript.pdf',
  size: 73,
  buffer: fileBytes.pdf(),
  kind: 'PDF',
  mimeType: 'application/pdf',
};
const png: ValidatedFile = {
  originalName: 'page 2.png',
  size: 72,
  buffer: fileBytes.png(),
  kind: 'IMAGE',
  mimeType: 'image/png',
};
const row = (id: string, fileName: string) => ({
  id,
  type: StudentDocumentType.TRANSCRIPT,
  fileName,
  mimeType: 'application/pdf',
  fileSize: 73,
  status: ProcessingStatus.PENDING,
  errorMessage: null,
  processedAt: null,
  createdAt: new Date('2026-11-23T10:00:00Z'),
});

describe('DocumentsService', () => {
  const repo = {
    findSelection: vi.fn(),
    createDocuments: vi.fn(),
    markFailed: vi.fn(),
    listDocuments: vi.fn(),
  };
  const queue = { enqueue: vi.fn() };
  let storage: InMemoryStorage;
  let service: DocumentsService;

  beforeEach(async () => {
    vi.clearAllMocks();
    storage = new InMemoryStorage();
    repo.findSelection.mockResolvedValue({
      studentId: 'sp-1',
      catalogStatus: ProcessingStatus.COMPLETED,
    });
    repo.createDocuments.mockResolvedValue([
      row('d1', 'transcript.pdf'),
      row('d2', 'page 2.png'),
    ]);

    const moduleRef = await Test.createTestingModule({
      providers: [
        DocumentsService,
        { provide: DocumentsRepository, useValue: repo },
        { provide: StorageService, useValue: storage },
        { provide: TranscriptQueue, useValue: queue },
      ],
    }).compile();
    service = moduleRef.get(DocumentsService);
  });

  describe('upload', () => {
    it('answers 422 before storing anything when no university and major are selected', async () => {
      repo.findSelection.mockResolvedValue(null);

      const attempt = service.upload('u1', StudentDocumentType.TRANSCRIPT, [
        pdf,
      ]);
      await expect(attempt).rejects.toThrow(UnprocessableEntityException);
      await expect(attempt).rejects.toThrow('Select your university first');
      expect(storage.objects.size).toBe(0);
    });

    it.each([
      ProcessingStatus.PENDING,
      ProcessingStatus.PROCESSING,
      ProcessingStatus.FAILED,
    ])("answers 422 while the major's catalog is %s", async (catalogStatus) => {
      repo.findSelection.mockResolvedValue({
        studentId: 'sp-1',
        catalogStatus,
      });

      await expect(
        service.upload('u1', StudentDocumentType.TRANSCRIPT, [pdf]),
      ).rejects.toThrow("Your university's course catalog isn't ready yet");
    });

    it('stores each file under a server-generated key in the student folder', async () => {
      await service.upload('u1', StudentDocumentType.TRANSCRIPT, [pdf, png]);

      const keys = [...storage.objects.keys()];
      expect(keys).toHaveLength(2);
      expect(keys[0]).toMatch(/^documents\/sp-1\/[0-9a-f-]{36}\.pdf$/);
      // The client's file name ("page 2.png") never becomes part of the key.
      expect(keys[1]).toMatch(/^documents\/sp-1\/[0-9a-f-]{36}\.png$/);
    });

    it('saves PENDING documents with the original name and the detected type, then queues one job', async () => {
      const result = await service.upload(
        'u1',
        StudentDocumentType.DEGREE_AUDIT,
        [pdf, png],
      );

      const [studentId, type, files] = repo.createDocuments.mock.calls[0] as [
        string,
        string,
        {
          fileName: string;
          fileUrl: string;
          mimeType: string;
          fileSize: number;
        }[],
      ];
      expect(studentId).toBe('sp-1');
      expect(type).toBe('DEGREE_AUDIT');
      expect(files).toEqual([
        {
          fileName: 'transcript.pdf',
          fileUrl: expect.stringMatching(/^documents\//),
          mimeType: 'application/pdf',
          fileSize: 73,
        },
        {
          fileName: 'page 2.png',
          fileUrl: expect.stringMatching(/^documents\//),
          mimeType: 'image/png',
          fileSize: 72,
        },
      ]);
      expect(queue.enqueue).toHaveBeenCalledWith({
        studentId: 'sp-1',
        documentIds: ['d1', 'd2'],
      });
      expect(result[0]).toEqual({
        id: 'd1',
        type: 'TRANSCRIPT',
        fileName: 'transcript.pdf',
        mimeType: 'application/pdf',
        fileSize: 73,
        status: 'PENDING',
        errorMessage: null,
        processedAt: null,
        createdAt: '2026-11-23T10:00:00.000Z',
      });
    });

    it('answers 503 and removes what it stored when storage fails midway', async () => {
      const put = vi.spyOn(storage, 'put');
      put
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('S3 down'));
      const remove = vi.spyOn(storage, 'delete');

      await expect(
        service.upload('u1', StudentDocumentType.TRANSCRIPT, [pdf, png]),
      ).rejects.toThrow(ServiceUnavailableException);
      expect(remove).toHaveBeenCalledOnce();
      expect(repo.createDocuments).not.toHaveBeenCalled();
    });

    it('answers 503 and marks the documents failed when the job cannot be queued', async () => {
      queue.enqueue.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(
        service.upload('u1', StudentDocumentType.TRANSCRIPT, [pdf]),
      ).rejects.toThrow('Document processing is unavailable, try again later');
      expect(repo.markFailed).toHaveBeenCalledWith(
        ['d1', 'd2'],
        'Processing could not start, upload the files again',
      );
    });
  });

  describe('list', () => {
    it("lists the user's documents, optionally of one type, with ISO dates", async () => {
      repo.listDocuments.mockResolvedValue([row('d1', 'transcript.pdf')]);

      const result = await service.list('u1', StudentDocumentType.TRANSCRIPT);

      expect(repo.listDocuments).toHaveBeenCalledWith('u1', 'TRANSCRIPT');
      expect(result[0].createdAt).toBe('2026-11-23T10:00:00.000Z');
    });
  });
});
