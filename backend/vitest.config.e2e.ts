import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    // Decorator metadata (class-transformer, Nest DI) needs this polyfill loaded first.
    setupFiles: ['reflect-metadata'],
    include: ['**/*.e2e-spec.ts'],
    // Placeholder values so ConfigModule's validation passes. No test connects to the
    // database: e2e tests replace the data-access providers with in-memory fakes.
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://test:test@localhost:5432/acadpath_test',
      ACCESS_TOKEN_SECRET: 'test-access-secret-that-is-at-least-32-chars',
      REFRESH_TOKEN_SECRET: 'test-refresh-secret-that-is-at-least-32-chars',
      OPENROUTER_KEY: 'test-key-never-used',
      // Never connected to: e2e tests replace the queue and the worker with fakes.
      REDIS_URL: 'redis://localhost:6379',
      OPENROUTER_VISION_MODEL: 'test/vision-model',
      // Never connected to: e2e tests replace StorageService with an in-memory fake.
      S3_BUCKET: 'test-bucket',
      S3_ACCESS_KEY_ID: 'test-access-key',
      S3_SECRET_ACCESS_KEY: 'test-secret-key',
    },
  },
});
