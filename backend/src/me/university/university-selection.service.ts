import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { CatalogQueue } from '../../catalog/catalog.queue.js';
import { ProcessingStatus } from '../../generated/prisma/enums.js';
import { toCatalogStatus } from '../catalog-status.js';
import type { UniversityData } from '../me.types.js';
import type { SelectUniversityDto } from '../dto/select-university.dto.js';
import {
  collapseWhitespace,
  findMatchingUniversity,
} from './university-match.js';
import { UniversityRepository } from './university.repository.js';

/**
 * PUT /me/university (v1: services/me/university/select-university.service.ts).
 *
 * v1 ran the AI search and extraction inside the request. Here the request only saves
 * the choice and, if the major's catalog isn't there yet, queues the extraction for
 * the catalog worker; the client follows catalog.status through GET /me.
 */
@Injectable()
export class UniversitySelectionService {
  private readonly logger = new Logger(UniversitySelectionService.name);

  constructor(
    private readonly repo: UniversityRepository,
    private readonly catalogQueue: CatalogQueue,
  ) {}

  async select(
    userId: string,
    input: SelectUniversityDto,
  ): Promise<UniversityData & { replaced: boolean }> {
    const match = findMatchingUniversity(
      await this.repo.listUniversities(),
      input,
    );
    const universityId =
      match?.id ??
      (
        await this.repo.upsertUniversity({
          name: collapseWhitespace(input.name),
          country: collapseWhitespace(input.country),
          city: collapseWhitespace(input.city),
        })
      ).id;

    const major = await this.repo.findOrCreateMajor(
      universityId,
      input.major.trim(),
    );
    const { previousUniversityId } = await this.repo.saveSelection(
      userId,
      universityId,
      major.id,
    );

    let { catalogStatus, catalogError } = major;
    // Not yet extracted, or failed before: (re)try. PROCESSING and COMPLETED are left alone.
    if (
      catalogStatus === ProcessingStatus.PENDING ||
      catalogStatus === ProcessingStatus.FAILED
    ) {
      await this.repo.markMajorPending(major.id);
      try {
        await this.catalogQueue.enqueue({
          majorId: major.id,
          universityId,
          universityName: input.name.trim(),
          city: input.city.trim(),
          country: input.country.trim(),
          majorName: major.name,
        });
      } catch (error) {
        // The major stays PENDING, so selecting it again re-queues it.
        this.logger.error('Could not queue catalog extraction', error);
        throw new ServiceUnavailableException(
          'Catalog extraction is unavailable, try again later',
        );
      }
      catalogStatus = ProcessingStatus.PENDING;
      catalogError = null;
    }

    const summary = await this.repo.getCatalogSummary(universityId, major.id);
    const { catalogStatus: _status, catalogError: _error, ...majorDto } = major;

    return {
      university: summary.university,
      major: majorDto,
      catalog: {
        status: toCatalogStatus(catalogStatus),
        error: catalogError,
        title: summary.title,
        source: summary.source,
        courseCount: summary.courseCount,
        majorCount: summary.majorCount,
      },
      replaced:
        previousUniversityId !== null && previousUniversityId !== universityId,
    };
  }
}
