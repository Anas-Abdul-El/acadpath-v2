import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AtLeastOneFieldPipe } from '../common/pipes/at-least-one-field.pipe.js';
import { UserRole } from '../generated/prisma/enums.js';
// DTOs are value imports: the ValidationPipe needs the class at runtime.
import { SelectUniversityDto } from './dto/select-university.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { YearOfStudyDto } from './dto/year-of-study.dto.js';
import { MeService } from './me.service.js';
import type { MeData, UniversityData, YearOfStudyData } from './me.types.js';
import { UniversitySelectionService } from './university/university-selection.service.js';

/**
 * /api/me: the logged-in user's own data (v1: routes/me.route.ts).
 *
 * No route takes a user id from the path or body. The id always comes from
 * @CurrentUser(), the user the access-token guard verified, so a student can only ever
 * read or change their own records. Every route needs a token (the global guard), and
 * all but GET /me are for students only (@Roles).
 */
@Controller('me')
export class MeController {
  constructor(
    private readonly meService: MeService,
    private readonly universitySelection: UniversitySelectionService,
  ) {}

  /** Open to admins too: they get profile and onboarding as null. */
  @Get()
  async getMe(@CurrentUser() user: AuthUser): Promise<{ data: MeData }> {
    return { data: await this.meService.getMe(user.id) };
  }

  /**
   * Saves the student's university and major. If the major's course catalog isn't
   * extracted yet, the extraction is queued and catalog.status is PROCESSING; the client
   * polls GET /me until it becomes AVAILABLE or UNAVAILABLE.
   */
  @Put('university')
  @Roles(UserRole.STUDENT)
  async selectUniversity(
    @CurrentUser() user: AuthUser,
    @Body() dto: SelectUniversityDto,
  ): Promise<{ data: UniversityData & { replaced: boolean } }> {
    return { data: await this.universitySelection.select(user.id, dto) };
  }

  @Put('year-of-study')
  @Roles(UserRole.STUDENT)
  async updateYearOfStudy(
    @CurrentUser() user: AuthUser,
    @Body() dto: YearOfStudyDto,
  ): Promise<{ data: YearOfStudyData }> {
    return {
      data: await this.meService.updateYearOfStudy(user.id, dto.yearOfStudy),
    };
  }

  @Patch('profile')
  @Roles(UserRole.STUDENT)
  async updateProfile(
    @CurrentUser() user: AuthUser,
    @Body(AtLeastOneFieldPipe) dto: UpdateProfileDto,
  ): Promise<{ data: MeData }> {
    return { data: await this.meService.updateProfile(user.id, dto) };
  }

  /** 200 (not Nest's default 201 for POST): it updates the profile, as in v1. */
  @Post('onboarding/complete')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.STUDENT)
  async completeOnboarding(
    @CurrentUser() user: AuthUser,
  ): Promise<{ data: MeData }> {
    return { data: await this.meService.completeOnboarding(user.id) };
  }
}
