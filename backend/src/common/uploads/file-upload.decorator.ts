import {
  UnsupportedMediaTypeException,
  UseInterceptors,
  applyDecorators,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ALLOWED_MIME_TYPES,
  FILES_FIELD,
  MAX_FILE_SIZE,
  MAX_FILES,
} from './upload.constants.js';

/**
 * Accepts up to 20 files under the "files" field (v1: upload.array("files", 20)).
 *
 * FilesInterceptor runs multer before the handler. Files stay in memory (no disk, no
 * client-chosen paths); multer stops the upload as soon as a file passes 25 MB or a
 * 21st file arrives, and rejects a declared type outside the allowed list. The bytes
 * are checked afterwards by UploadedFilesPipe.
 * Docs: https://docs.nestjs.com/techniques/file-upload
 */
export const FileUpload = () =>
  applyDecorators(
    UseInterceptors(
      FilesInterceptor(FILES_FIELD, MAX_FILES, {
        limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES },
        fileFilter: (_req, file, callback) => {
          if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
            callback(
              new UnsupportedMediaTypeException(
                'Only PDF, PNG, JPEG or WebP files are allowed',
              ),
              false,
            );
            return;
          }
          callback(null, true);
        },
      }),
    ),
  );
