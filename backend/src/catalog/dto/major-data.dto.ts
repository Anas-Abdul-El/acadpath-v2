import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsObject,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { CourseCategory, Term } from '../../generated/prisma/enums.js';

// The course-extraction AI reply (v1: majorDataSchema). A field that "may be null"
// must still be present: ValidateIf(v !== null) skips the rules only for an explicit
// null, so a missing key (undefined) is rejected, like Zod's .nullable().

export class MajorInfoDto {
  @IsString()
  @MinLength(1)
  name: string;

  @ValidateIf((_o, value) => value !== null)
  @IsInt()
  @Min(1)
  @Max(300)
  totalRequiredCredits: number | null;
}

export class CourseDataDto {
  @IsString()
  @MinLength(1)
  code: string;

  @IsString()
  @MinLength(1)
  name: string;

  @ValidateIf((_o, value) => value !== null)
  @IsString()
  description: string | null;

  @IsInt()
  @Min(0)
  credits: number;

  @IsEnum(CourseCategory)
  category: CourseCategory;

  /** Defaults to [] when the AI leaves it out (v1: .default([])). */
  @IsArray()
  @IsEnum(Term, { each: true })
  offeredTerms: Term[] = [];

  @IsArray()
  @IsString({ each: true })
  prerequisites: string[];

  @IsArray()
  @IsString({ each: true })
  corequisites: string[];
}

export class MajorDataDto {
  /** null when the sources had nothing about the requested major. */
  @ValidateIf((_o, value) => value !== null)
  @IsObject()
  @ValidateNested()
  @Type(() => MajorInfoDto)
  major: MajorInfoDto | null;

  // @ValidateNested alone accepts a missing field; @IsArray makes it required.
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CourseDataDto)
  courses: CourseDataDto[];
}
