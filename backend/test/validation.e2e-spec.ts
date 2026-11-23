import { Test } from '@nestjs/testing';
import { Body, Controller, INestApplication, Post } from '@nestjs/common';
import { IsInt, IsString, Max, Min } from 'class-validator';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { configureApp } from './../src/app.setup.js';

// A throwaway DTO + controller that exist only to exercise the global ValidationPipe.
class CreateCourseDto {
  @IsString()
  code: string;

  @IsInt()
  @Min(0)
  @Max(6)
  credits: number;
}

@Controller('validation-test')
class ValidationTestController {
  @Post()
  create(@Body() dto: CreateCourseDto) {
    return { isDto: dto instanceof CreateCourseDto, dto };
  }
}

describe('Global ValidationPipe (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture = await Test.createTestingModule({
      controllers: [ValidationTestController],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('accepts a valid body and transforms it into a DTO instance', () => {
    return request(app.getHttpServer())
      .post('/validation-test')
      .send({ code: 'CSCI250', credits: 3 })
      .expect(201)
      .expect({ isDto: true, dto: { code: 'CSCI250', credits: 3 } });
  });

  it('rejects a body that breaks the DTO rules', async () => {
    const res = await request(app.getHttpServer())
      .post('/validation-test')
      .send({ code: 42, credits: 9 })
      .expect(400);

    expect(res.body.message).toEqual(
      expect.arrayContaining([
        'code must be a string',
        'credits must not be greater than 6',
      ]),
    );
  });

  it('rejects properties that are not on the DTO', async () => {
    const res = await request(app.getHttpServer())
      .post('/validation-test')
      .send({ code: 'CSCI250', credits: 3, role: 'admin' })
      .expect(400);

    expect(res.body.message).toContain('property role should not exist');
  });
});
