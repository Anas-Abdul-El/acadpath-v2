import { IsEnum, IsOptional } from 'class-validator';
import { StudentDocumentType } from '../../../generated/prisma/enums.js';

/** GET /me/documents?type=... (v1: documentsQuerySchema). */
export class DocumentsQueryDto {
  @IsOptional()
  @IsEnum(StudentDocumentType, { message: 'Select a valid document type' })
  type?: StudentDocumentType;
}
