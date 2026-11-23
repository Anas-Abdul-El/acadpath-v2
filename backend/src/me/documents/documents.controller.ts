import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UploadedFiles,
} from '@nestjs/common';
import type { AuthUser } from '../../auth/auth.types.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { Roles } from '../../auth/decorators/roles.decorator.js';
import { Polled } from '../../common/decorators/polled.decorator.js';
import { FileUpload } from '../../common/uploads/file-upload.decorator.js';
import {
  UploadedFilesPipe,
  type ValidatedFile,
} from '../../common/uploads/uploaded-files.pipe.js';
import { UserRole } from '../../generated/prisma/enums.js';
import { DocumentsQueryDto } from './dto/documents-query.dto.js';
import { UploadDocumentsDto } from './dto/upload-documents.dto.js';
import {
  DocumentsService,
  type StudentDocumentDto,
} from './documents.service.js';

/**
 * /api/me/documents: the student's transcripts and other academic documents.
 *
 * Guards run before interceptors, so a request without a valid student token is
 * rejected before FileUpload (multer) reads a single byte of the files.
 */
@Controller('me/documents')
@Roles(UserRole.STUDENT)
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  /** Polled by the frontend while documents are processing. */
  @Get()
  @Polled()
  async list(
    @CurrentUser() user: AuthUser,
    @Query() query: DocumentsQueryDto,
  ): Promise<{ data: StudentDocumentDto[] }> {
    return { data: await this.documents.list(user.id, query.type) };
  }

  /** 202 Accepted: the files are stored and queued; follow their status with GET. */
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @FileUpload()
  async upload(
    @CurrentUser() user: AuthUser,
    @UploadedFiles(new UploadedFilesPipe({ unsupportedTypeStatus: 415 }))
    files: ValidatedFile[],
    @Body() dto: UploadDocumentsDto,
  ): Promise<{ data: StudentDocumentDto[] }> {
    return { data: await this.documents.upload(user.id, dto.type, files) };
  }
}
