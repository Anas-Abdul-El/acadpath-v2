import { IsEnum, ValidateIf } from 'class-validator';
import { YearOfStudy } from '../../generated/prisma/enums.js';

/**
 * PATCH /api/me/profile body (v1: updateProfileSchema): every field optional, at least
 * one required (checked by AtLeastOneFieldPipe on the route).
 *
 * Not `PartialType(YearOfStudyDto)`: PartialType marks fields @IsOptional(), which also
 * lets `null` through, and `{ yearOfStudy: null }` would then clear the saved year.
 * ValidateIf skips the rules only when the field is absent, so null is still rejected.
 */
export class UpdateProfileDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsEnum(YearOfStudy, { message: 'Select a valid year of study' })
  yearOfStudy?: YearOfStudy;
}
