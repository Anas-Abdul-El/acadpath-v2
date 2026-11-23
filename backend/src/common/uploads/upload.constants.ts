// Upload limits, the same as v1 (middlewares/upload.ts + schemas/me.schema.ts).
export const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB per file
export const MAX_FILES = 20;
export const MAX_TOTAL_SIZE = 150 * 1024 * 1024; // 150 MB per request

/** Declared types multer lets through; the bytes are checked again afterwards. */
export const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
]);

/** The multipart field the files are sent under. */
export const FILES_FIELD = 'files';
