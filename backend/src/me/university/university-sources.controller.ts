import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
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
import {
  UniversitySourcesService,
  type UniversitySourceDto,
} from './university-sources.service.js';

/** /api/me/university/sources: catalog files for the student's university. */
@Controller('me/university/sources')
@Roles(UserRole.STUDENT)
export class UniversitySourcesController {
  constructor(private readonly sources: UniversitySourcesService) {}

  /** Polled by the frontend while sources are processing. */
  @Get()
  @Polled()
  async list(
    @CurrentUser() user: AuthUser,
  ): Promise<{ data: UniversitySourceDto[] }> {
    return { data: await this.sources.list(user.id) };
  }

  /** 202 Accepted: stored and queued. A file that isn't a PDF or image is a 400, as in v1. */
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @FileUpload()
  async upload(
    @CurrentUser() user: AuthUser,
    @UploadedFiles(new UploadedFilesPipe()) files: ValidatedFile[],
  ): Promise<{ data: UniversitySourceDto[] }> {
    return { data: await this.sources.upload(user.id, files) };
  }
}
