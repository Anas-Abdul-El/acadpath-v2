import { randomUUID } from 'node:crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/env.validation.js';
import {
  EXTENSIONS,
  S3_CLIENT,
  type StorageClient,
} from './storage.constants.js';

/** Ids that are safe as one path segment: no "/", "..", or anything else. */
const SAFE_SEGMENT = /^[A-Za-z0-9-]+$/;

/**
 * Private object storage for uploaded files (v1: libs/storage.ts + storeDocument).
 * Files are never served directly: the bucket is private and keys are built here,
 * so no client-supplied name ever becomes part of a storage path.
 */
@Injectable()
export class StorageService {
  private readonly bucket: string;

  constructor(
    @Inject(S3_CLIENT) private readonly s3: StorageClient,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.bucket = config.getOrThrow('S3_BUCKET', { infer: true });
  }

  /** e.g. documents/<studentId>/<uuid>.pdf. The extension comes from the detected type. */
  newKey(
    folder: 'documents' | 'sources',
    ownerId: string,
    contentType: string,
  ): string {
    if (!SAFE_SEGMENT.test(ownerId)) {
      throw new Error('Invalid storage owner id');
    }
    return `${folder}/${ownerId}/${randomUUID()}.${EXTENSIONS[contentType] ?? 'bin'}`;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async get(key: string): Promise<Buffer> {
    const { Body } = await this.s3.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!Body) throw new Error(`Empty object: ${key}`);
    return Buffer.from(await Body.transformToByteArray());
  }

  async delete(key: string): Promise<void> {
    await this.s3.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
}
