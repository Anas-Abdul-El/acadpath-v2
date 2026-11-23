import { HttpStatus, Injectable, type PipeTransform } from '@nestjs/common';
import {
  ValidationFailedException,
  type ValidationIssue,
} from '../validation/validation-failed.exception.js';
import { detectFileType, type DetectedType } from './detect-file-type.js';
import { MAX_TOTAL_SIZE } from './upload.constants.js';

/** An uploaded file after validation: its type comes from its bytes. */
export interface ValidatedFile extends DetectedType {
  /** The client's file name: shown back to the user, never used in a storage path. */
  originalName: string;
  size: number;
  buffer: Buffer;
}

/**
 * Checks the files multer received (v1: validateFiles + uploadedFilesSchema): at least
 * one, none empty, each a real PDF or image by its bytes, 150 MB at most in total.
 * Every problem is reported at once, like v1. Per-file size and count are already
 * enforced by multer while the request streams in (see FileUpload).
 *
 * Use it on the files parameter: `@UploadedFiles(new UploadedFilesPipe()) files`.
 */
@Injectable()
export class UploadedFilesPipe implements PipeTransform<
  unknown,
  ValidatedFile[]
> {
  private readonly unsupportedTypeStatus: number;

  /** unsupportedTypeStatus: 400 by default; 415 for documents, as in v1. */
  constructor({ unsupportedTypeStatus = HttpStatus.BAD_REQUEST } = {}) {
    this.unsupportedTypeStatus = unsupportedTypeStatus;
  }

  transform(value: unknown): ValidatedFile[] {
    const files = Array.isArray(value) ? (value as Express.Multer.File[]) : [];
    if (files.length === 0) {
      throw new ValidationFailedException([
        { path: 'files', message: 'Upload at least one file' },
      ]);
    }

    const issues: ValidationIssue[] = [];
    let status: number = HttpStatus.BAD_REQUEST;
    const validated: ValidatedFile[] = [];

    files.forEach((file, index) => {
      if (file.size === 0) {
        issues.push({ path: `${index}.size`, message: 'File is empty' });
        return;
      }
      const type = detectFileType(file.buffer);
      if (!type) {
        issues.push({
          path: String(index),
          message: 'File must be a PDF, PNG, JPEG or WebP',
        });
        status = this.unsupportedTypeStatus;
        return;
      }
      validated.push({
        originalName: file.originalname,
        size: file.size,
        buffer: file.buffer,
        ...type,
      });
    });

    const total = files.reduce((sum, file) => sum + file.size, 0);
    if (total > MAX_TOTAL_SIZE) {
      issues.push({
        path: '',
        message: 'Files must be 150 MB or smaller in total',
      });
      if (status === HttpStatus.BAD_REQUEST)
        status = HttpStatus.PAYLOAD_TOO_LARGE;
    }

    if (issues.length > 0) throw new ValidationFailedException(issues, status);
    return validated;
  }
}
