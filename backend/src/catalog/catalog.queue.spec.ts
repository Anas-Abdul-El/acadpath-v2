import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import {
  CATALOG_QUEUE,
  CatalogQueue,
  type CatalogJobData,
} from './catalog.queue.js';

describe('CatalogQueue', () => {
  const queue = { add: vi.fn() };
  let catalogQueue: CatalogQueue;

  beforeEach(async () => {
    vi.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        CatalogQueue,
        { provide: getQueueToken(CATALOG_QUEUE), useValue: queue },
      ],
    }).compile();
    catalogQueue = moduleRef.get(CatalogQueue);
  });

  it('enqueues one job per major, retried with backoff, removed once finished', async () => {
    const data: CatalogJobData = {
      majorId: 'major-cs',
      universityId: 'uni-liu',
      universityName: 'LIU',
      city: 'Beirut',
      country: 'Lebanon',
      majorName: 'Computer Science',
    };

    await catalogQueue.enqueue(data);

    expect(queue.add).toHaveBeenCalledWith('extract', data, {
      // Same id for the same major: a second request while one is queued is a no-op.
      jobId: 'major-cs',
      attempts: 3,
      backoff: { type: 'exponential', delay: 30_000 },
      // The outcome lives on the Major row, so finished jobs needn't stay in Redis.
      removeOnComplete: true,
      removeOnFail: true,
    });
  });
});
