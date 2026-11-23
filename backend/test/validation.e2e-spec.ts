import { Test } from '@nestjs/testing';
import { Body, Controller, INestApplication, Post } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsString, Max, Min, ValidateNested } from 'class-validator';
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

class CreatePlanDto {
  @ValidateNested({ each: true })
  @Type(() => CreateCourseDto)
  courses: CreateCourseDto[];
}

@Controller('validation-test')
class ValidationTestController {
  @Post()
  create(@Body() dto: CreateCourseDto) {
    return { isDto: dto instanceof CreateCourseDto, dto };
  }

  @Post('plan')
  createPlan(@Body() dto: CreatePlanDto) {
    return dto;
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
      .post('/api/validation-test')
      .send({ code: 'CSCI250', credits: 3 })
      .expect(201)
      .expect({ isDto: true, dto: { code: 'CSCI250', credits: 3 } });
  });

  it('rejects a body that breaks the DTO rules, in the v1 error shape', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/validation-test')
      .send({ code: 42, credits: 9 })
      .expect(400);

    // One entry per invalid field (stopAtFirstError), like v1's Zod-based AppErr.
    expect(res.body).toEqual({
      error: {
        message: 'Validation failed',
        details: [
          { path: 'code', message: 'code must be a string' },
          { path: 'credits', message: 'credits must not be greater than 6' },
        ],
      },
    });
  });

  it('rejects properties that are not on the DTO', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/validation-test')
      .send({ code: 'CSCI250', credits: 3, role: 'admin' })
      .expect(400);

    expect(res.body.error.details).toEqual([
      { path: 'role', message: 'property role should not exist' },
    ]);
  });

  it('reports nested fields with a dotted path', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/validation-test/plan')
      .send({
        courses: [
          { code: 'CSCI250', credits: 3 },
          { code: 'X', credits: 7 },
        ],
      })
      .expect(400);

    expect(res.body.error.details).toEqual([
      {
        path: 'courses.1.credits',
        message: 'credits must not be greater than 6',
      },
    ]);
  });
});
