import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

/** Letters (any script), spaces, and . ' ’ ( ) - (v1: PLACE_NAME). */
const PLACE_NAME = /^[\p{L}\p{M}\s.'’()-]+$/u;

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * PUT /api/me/university body (v1: selectUniversitySchema, the same rules as the
 * frontend's form). Every field is trimmed first. Rules run bottom to top and only the
 * first failure is reported, so read each list upwards.
 */
export class SelectUniversityDto {
  @Transform(trim)
  @MaxLength(120, { message: 'Use 120 characters or fewer' })
  @MinLength(3, { message: "Enter your university's full name" })
  @MinLength(1, { message: 'University name is required' })
  @IsString({ message: 'University name is required' })
  name: string;

  @Transform(trim)
  @Matches(PLACE_NAME, { message: 'Use letters only' })
  @MaxLength(60, { message: 'Use 60 characters or fewer' })
  @MinLength(2, { message: 'Enter the full country name' })
  @MinLength(1, { message: 'Country is required' })
  @IsString({ message: 'Country is required' })
  country: string;

  @Transform(trim)
  @Matches(PLACE_NAME, { message: 'Use letters only' })
  @MaxLength(80, { message: 'Use 80 characters or fewer' })
  @MinLength(1, { message: 'City is required' })
  @IsString({ message: 'City is required' })
  city: string;

  @Transform(trim)
  @MaxLength(100, { message: 'Use 100 characters or fewer' })
  @MinLength(2, { message: "Enter your major's full name" })
  @MinLength(1, { message: 'Major is required' })
  @IsString({ message: 'Major is required' })
  major: string;
}
