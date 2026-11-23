import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  AcademicRecordStatus,
  LetterGrade,
  Term,
} from '../../generated/prisma/enums.js';

/** One course on the transcript, as the AI read it (v1: transcriptDataSchema). */
export class TranscriptRecordDto {
  @IsString()
  @MinLength(1)
  code: string;

  @IsEnum(AcademicRecordStatus)
  status: AcademicRecordStatus;

  /** null for in-progress or pass/fail courses; must still be present. */
  @ValidateIf((_o, value) => value !== null)
  @IsEnum(LetterGrade)
  grade: LetterGrade | null;

  @IsEnum(Term)
  term: Term;

  @IsInt()
  @Min(1950)
  @Max(2100)
  year: number;
}

export class TranscriptDataDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TranscriptRecordDto)
  records: TranscriptRecordDto[];
}
