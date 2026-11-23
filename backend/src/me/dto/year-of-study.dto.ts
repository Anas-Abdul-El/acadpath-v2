import { IsEnum } from 'class-validator';
import { YearOfStudy } from '../../generated/prisma/enums.js';

/** PUT /api/me/year-of-study body (v1: yearOfStudySchema). */
export class YearOfStudyDto {
  // IsEnum rejects undefined and null too, so the field is required.
  @IsEnum(YearOfStudy, { message: 'Select a valid year of study' })
  yearOfStudy: YearOfStudy;
}
