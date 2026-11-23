import { Test } from '@nestjs/testing';
import {
  Controller,
  INestApplication,
  Post,
  UploadedFiles,
} from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { configureApp } from './../src/app.setup.js';
import { FileUpload } from './../src/common/uploads/file-upload.decorator.js';
import {
  UploadedFilesPipe,
  type ValidatedFile,
} from './../src/common/uploads/uploaded-files.pipe.js';
import { fileBytes } from './fixtures/files.js';

@Controller('uploads-test')
class UploadsTestController {
  @Post()
  @FileUpload()
  upload(
    @UploadedFiles(new UploadedFilesPipe({ unsupportedTypeStatus: 415 }))
    files: ValidatedFile[],
  ) {
    return files.map(({ originalName, kind, mimeType, size }) => ({
      originalName,
      kind,
      mimeType,
      size,
    }));
  }
}

// Real multipart requests through multer, the interceptor and the pipe.
describe('File uploads (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture = await Test.createTestingModule({
      controllers: [UploadsTestController],
    }).compile();
    app = moduleFixture.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const post = () => request(app.getHttpServer()).post('/api/uploads-test');

  it('accepts PDFs and images sent as "files"', async () => {
    const res = await post()
      .attach('files', fileBytes.pdf(), {
        filename: 'transcript.pdf',
        contentType: 'application/pdf',
      })
      .attach('files', fileBytes.png(), {
        filename: 'page.png',
        contentType: 'image/png',
      })
      .expect(201);

    expect(res.body).toEqual([
      {
        originalName: 'transcript.pdf',
        kind: 'PDF',
        mimeType: 'application/pdf',
        size: 73,
      },
      {
        originalName: 'page.png',
        kind: 'IMAGE',
        mimeType: 'image/png',
        size: 72,
      },
    ]);
  });

  it('refuses a declared type that is not allowed, with 415', async () => {
    const res = await post()
      .attach('files', Buffer.from('a,b'), {
        filename: 'grades.csv',
        contentType: 'text/csv',
      })
      .expect(415);

    expect(res.body).toEqual({
      error: { message: 'Only PDF, PNG, JPEG or WebP files are allowed' },
    });
  });

  it('refuses a file that claims to be a PDF but is not, with 415', async () => {
    await post()
      .attach('files', fileBytes.exe(), {
        filename: 'evil.pdf',
        contentType: 'application/pdf',
      })
      .expect(415);
  });

  it('refuses a file over 25 MB with 413', async () => {
    const tooBig = Buffer.concat([
      fileBytes.pdf(),
      Buffer.alloc(25 * 1024 * 1024),
    ]);

    const res = await post()
      .attach('files', tooBig, {
        filename: 'big.pdf',
        contentType: 'application/pdf',
      })
      .expect(413);
    expect(res.body).toEqual({ error: { message: 'File too large' } });
  });

  it('refuses more than 20 files', async () => {
    let req = post();
    for (let i = 0; i < 21; i++) {
      req = req.attach('files', fileBytes.png(), {
        filename: `${i}.png`,
        contentType: 'image/png',
      });
    }

    const res = await req.expect(400);
    expect(res.body).toEqual({ error: { message: 'Too many files' } });
  });

  it('refuses a request without files', async () => {
    const res = await post().field('type', 'TRANSCRIPT').expect(400);

    expect(res.body.error.details).toEqual([
      { path: 'files', message: 'Upload at least one file' },
    ]);
  });

  it('refuses files sent under another field name', async () => {
    await post()
      .attach('document', fileBytes.pdf(), {
        filename: 'a.pdf',
        contentType: 'application/pdf',
      })
      .expect(400);
  });
});
