import { getQueueToken } from '@nestjs/bullmq';
import type { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { App } from 'supertest/types.js';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { CatalogProcessor } from '../../src/catalog/catalog.processor.js';
import { CATALOG_QUEUE } from '../../src/catalog/catalog.queue.js';

export interface TestApp {
  app: INestApplication<App>;
  /** The fake BullMQ queue: inspect `catalogQueue.add.mock.calls` to see enqueued jobs. */
  catalogQueue: { add: ReturnType<typeof vi.fn> };
}

/**
 * The real AppModule with the same setup as main.ts (configureApp), minus everything
 * that would leave the process: the BullMQ queue becomes an in-memory fake and the
 * worker is removed, so no test needs Redis. Pass providers to replace (e.g. a
 * repository with an in-memory fake) and extra test-only controllers.
 */
export async function createTestApp(
  options: {
    overrides?: [token: unknown, value: unknown][];
    controllers?: Type[];
  } = {},
): Promise<TestApp> {
  const catalogQueue = { add: vi.fn() };

  let builder = Test.createTestingModule({
    imports: [AppModule],
    controllers: options.controllers ?? [],
  })
    .overrideProvider(getQueueToken(CATALOG_QUEUE))
    .useValue(catalogQueue)
    // A plain object has no @Processor metadata, so no BullMQ worker is started.
    .overrideProvider(CatalogProcessor)
    .useValue({});

  for (const [token, value] of options.overrides ?? []) {
    builder = builder.overrideProvider(token).useValue(value);
  }

  const moduleFixture = await builder.compile();
  const app = moduleFixture.createNestApplication<INestApplication<App>>({
    logger: false,
  });
  configureApp(app);
  await app.init();
  return { app, catalogQueue };
}
