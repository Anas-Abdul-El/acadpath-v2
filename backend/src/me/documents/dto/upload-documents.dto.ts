import { IsEnum, IsOptional } from 'class-validator';
import { StudentDocumentType } from '../../../generated/prisma/enums.js';

/** Text fields of the POST /me/documents multipart body (v1: uploadDocumentsBodySchema). */
export class UploadDocumentsDto {
  @IsOptional()
  @IsEnum(StudentDocumentType, { message: 'Select a valid document type' })
  type: StudentDocumentType = StudentDocumentType.TRANSCRIPT;
}
