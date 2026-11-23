import { S3Client } from '@aws-sdk/client-s3';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/env.validation.js';
import { S3_CLIENT } from './storage.constants.js';
import { StorageService } from './storage.service.js';

/** Object storage. The S3 client is built once from validated config (factory provider). */
@Module({
  providers: [
    {
      provide: S3_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) => {
        const endpoint = config.get('S3_ENDPOINT', { infer: true });
        return new S3Client({
          region: config.getOrThrow('S3_REGION', { infer: true }),
          endpoint,
          // S3-compatible services (Neon, SeaweedFS, R2) need path-style addressing.
          forcePathStyle: endpoint !== undefined,
          credentials: {
            accessKeyId: config.getOrThrow('S3_ACCESS_KEY_ID', { infer: true }),
            secretAccessKey: config.getOrThrow('S3_SECRET_ACCESS_KEY', {
              infer: true,
            }),
          },
        });
      },
    },
    StorageService,
  ],
  exports: [StorageService],
})
export class StorageModule {}
