import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from './prisma.service.js';

describe('PrismaService', () => {
  let service: PrismaService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        PrismaService,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: vi.fn(() => 'postgresql://user:pw@localhost:5432/db'),
          },
        },
      ],
    }).compile();

    service = moduleRef.get(PrismaService);
  });

  it('exposes the Prisma model delegates, so it can be queried directly', () => {
    // Checked through typeof: the client is a proxy (instanceof fails), and printing it
    // in a failure message overflows the stack.
    expect(typeof service.user.findUnique).toBe('function');
    expect(typeof service.session.create).toBe('function');
  });

  it('closes the connection pool when the app shuts down', async () => {
    const disconnect = vi
      .spyOn(service, '$disconnect')
      .mockResolvedValue(undefined);

    await service.onModuleDestroy();

    expect(disconnect).toHaveBeenCalledOnce();
  });
});
