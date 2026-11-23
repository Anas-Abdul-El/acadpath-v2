import type { S3Client } from '@aws-sdk/client-s3';

/** Injection token for the S3 client. */
export const S3_CLIENT = Symbol('S3_CLIENT');

/** The one method StorageService uses, so tests only fake that. */
export type StorageClient = Pick<S3Client, 'send'>;

/** File extension per detected content type; anything else is stored as .bin. */
export const EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};
