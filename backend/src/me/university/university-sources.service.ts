import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { CatalogQueue } from '../../catalog/catalog.queue.js';
import type { ValidatedFile } from '../../common/uploads/uploaded-files.pipe.js';
import {
  SourceType,
  type ProcessingStatus,
} from '../../generated/prisma/enums.js';
import { StorageService } from '../../storage/storage.service.js';
import { storeFiles } from '../../storage/store-files.js';
import { getSourceStatus, type SourceState } from '../catalog-status.js';
import { UniversityRepository } from './university.repository.js';

/** A catalog source as the client sees it (v1: UniversitySourceDto). */
export interface UniversitySourceDto {
  id: string;
  title: string | null;
  sourceType: SourceType;
  status: ProcessingStatus;
  errorMessage: string | null;
  createdAt: string;
}

const toDto = (
  row: SourceState & {
    id: string;
    title: string | null;
    sourceType: SourceType;
    createdAt: Date;
  },
): UniversitySourceDto => ({
  id: row.id,
  title: row.title,
  sourceType: row.sourceType,
  status: getSourceStatus(row),
  errorMessage: row.errorMessage,
  createdAt: row.createdAt.toISOString(),
});

/**
 * POST and GET /me/university/sources (v1: upload-university-sources.service.ts and
 * get-university-sources.service.ts): a student uploads their major's study plan or
 * catalog when the web search found nothing (or not enough).
 */
@Injectable()
export class UniversitySourcesService {
  private readonly logger = new Logger(UniversitySourcesService.name);

  constructor(
    private readonly repo: UniversityRepository,
    private readonly storage: StorageService,
    private readonly catalogQueue: CatalogQueue,
  ) {}

  async upload(
    userId: string,
    files: ValidatedFile[],
  ): Promise<UniversitySourceDto[]> {
    const selection = await this.repo.findSourcesSelection(userId);
    if (!selection?.major) {
      throw new UnprocessableEntityException('Select your university first');
    }
    const { university, major } = selection;

    const stored = await storeFiles(
      this.storage,
      'sources',
      university.id,
      files,
    );
    const sources = await this.repo.createUploadedSources(
      university.id,
      userId,
      stored.map(({ file, key }) => ({
        title: file.originalName,
        url: key,
        sourceType: file.kind === 'PDF' ? SourceType.PDF : SourceType.IMAGE,
      })),
    );
    const sourceIds = sources.map((s) => s.id);
    await this.repo.markMajorPendingIfIncomplete(major.id);

    try {
      await this.catalogQueue.enqueueUploadedSources({
        majorId: major.id,
        universityId: university.id,
        universityName: university.name,
        city: university.city,
        country: university.country,
        majorName: major.name,
        sourceIds,
      });
    } catch (error) {
      this.logger.error('Could not queue uploaded sources', error);
      await this.repo.markSourcesFailed(
        sourceIds,
        'Processing could not start, upload the files again',
      );
      throw new ServiceUnavailableException(
        'Catalog extraction is unavailable, try again later',
      );
    }

    return sources.map(toDto);
  }

  async list(userId: string): Promise<UniversitySourceDto[]> {
    const selection = await this.repo.findSourcesSelection(userId);
    if (!selection) {
      throw new UnprocessableEntityException('Select your university first');
    }
    return (await this.repo.listSources(selection.university.id)).map(toDto);
  }
}
