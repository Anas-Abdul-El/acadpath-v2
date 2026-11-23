---
name: nestjs
description: AcadPath v2 backend conventions for NestJS 12. Use when writing or reviewing code in backend/ — modules, controllers, providers, guards, pipes, interceptors, exception filters, config, validation, or tests — and when porting a v1 Express feature (../acadpath/backend) to Nest.
---

# NestJS in AcadPath v2

This skill applies the repo's `CLAUDE.md` and `backend/AGENTS.md` to day-to-day backend work. If
anything here disagrees with those files, they win.

## Before writing code

1. Read `backend/AGENTS.md`. NestJS 12 is newer than your training data.
2. Look up the API in the official docs. https://docs.nestjs.com/llms.txt indexes them, with one
   markdown page per chapter (for example `https://docs.nestjs.com/application/validation.md`).
   Don't write Nest APIs from memory.
3. When porting, read the v1 code first: routes, controller, service, middlewares, and the Prisma
   models in `../acadpath/backend/src` and `../acadpath/backend/prisma/schema.prisma`. Keep its
   behavior.
4. Check `backend/package.json` before importing anything. Prefer a first-party `@nestjs/*`
   package from the list in `AGENTS.md`. Ask before adding a dependency. Ask before choosing an ORM,
   since none has been chosen yet.

## Non-negotiable conventions

- **ESM.** Relative imports end in `.js` (`import { UsersService } from './users.service.js'`).
  Use `import.meta.dirname`, never `__dirname`. Use `import type` for type-only imports.
- **Validation is `class-validator` DTO classes through the global `ValidationPipe`**, not Zod.
  The DTO class is both the runtime rule set and the TypeScript type.
- **Tests are Vitest.** Mocks use `vi.fn()` and `vi.spyOn()`, never `jest.*`. Unit tests are
  `src/**/*.spec.ts`. E2E tests live in `test/` and run with `pnpm test:e2e`.
- **Strict types.** No `any`, `as any`, `@ts-ignore`, or unexplained `!`. Use `unknown` and parse
  it.
- **Thin controllers.** A controller handles HTTP shape only. Business rules live in providers.
  Authorization lives in guards and is always enforced on the server.

## v1 Express → v2 Nest mapping

| v1 (Express)                          | v2 (Nest)                                          | Why                                                                    |
| ------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------- |
| `routes/*.ts` + controller functions  | `@Controller()` class with `@Get()`/`@Post()`…    | Routes are declared on the class; Nest wires them up.                  |
| `services/*.ts` (imported directly)   | `@Injectable()` provider, injected in constructor  | The DI container creates it once and hands it to whoever needs it.    |
| `authenticate` middleware             | Guard (`CanActivate`)                              | Guards see the `ExecutionContext` (handler + metadata) and run after middleware. |
| `authorize(role)` middleware          | Guard + custom decorator read with `Reflector`     | Role metadata sits on the handler; the guard reads it.                 |
| `validate*` middleware (Zod)          | DTO class + global `ValidationPipe`                | Pipes transform/validate one argument right before the handler.    |
| `errorHandler` middleware             | Exception filter (`@Catch()`)                      | Filters catch thrown exceptions anywhere in the lifecycle.             |
| `config/*.ts` + `env.ts`              | `@nestjs/config` with a class-validator env class  | Config becomes an injectable provider, validated at boot.              |
| `express-rate-limit`                  | `@nestjs/throttler`                                | First-party, works with guards and per-route overrides.                |

Request lifecycle, in order: **middleware → guards → interceptors (before) → pipes → handler →
interceptors (after) → exception filters**. When you pick where code goes, say which stage it runs
in and why. Docs: https://docs.nestjs.com/faq/request-lifecycle

## Building a feature, step by step

Build in small steps the owner can review. Stop after each step and explain the concept the first
time it comes up (see `CLAUDE.md` §11).

1. **Module.** `pnpm exec nest g module <feature>`. Explain what a module is: a unit that groups
   providers and controllers, and decides which providers it `exports` to the modules that import it.
2. **Provider.** `pnpm exec nest g service <feature>`. Explain DI: you list a dependency in the
   constructor, and Nest supplies the instance.
3. **Controller.** `pnpm exec nest g controller <feature>`.
4. After running the CLI: make sure the generated imports end in `.js`, the generated spec uses
   Vitest (`vi.fn()`), and the module registered the new class.
5. **DTOs.** One class-validator DTO per request shape in `<feature>/dto/`. Derive update DTOs
   with `PartialType` instead of copying fields.
6. **Guards/filters** only when the feature needs them. Reuse existing ones before writing new
   ones.
7. **Tests**, then run the checks below.

## Patterns

### Validation with class-validator

The global `ValidationPipe` is already registered in `src/app.setup.ts` (`configureApp`), which
`main.ts` and the e2e tests both call. Don't register it again per controller.

```ts
// courses/dto/create-course.dto.ts
import { IsInt, IsString, Max, Min, MinLength } from 'class-validator';

export class CreateCourseDto {
  @IsString()
  @MinLength(1)
  code: string;

  @IsInt()
  @Min(0)
  @Max(6)
  credits: number;
}

// courses/dto/update-course.dto.ts
import { PartialType } from '@nestjs/mapped-types';
export class UpdateCourseDto extends PartialType(CreateCourseDto) {}

// courses/courses.controller.ts
@Post()
create(@Body() dto: CreateCourseDto) {
  return this.coursesService.create(dto);
}

@Get(':id')
findOne(@Param('id', ParseUUIDPipe) id: string) {
  return this.coursesService.findOne(id);
}
```

- One file per DTO in `<feature>/dto/<action>-<feature>.dto.ts`.
- DTOs must be **classes**, imported with a normal `import`, never `import type`. The pipe reads the
  parameter's type from decorator metadata at runtime; a type-only import (or an interface) erases
  it and validation silently does nothing.
- Every DTO property needs at least one decorator. `whitelist` + `forbidNonWhitelisted` reject any
  property without one with `400 "property x should not exist"`.
- `@IsOptional()` also lets `null` through. Use `@ValidateIf((_, v) => v !== undefined)` when `null`
  must be rejected.
- Nested objects need `@ValidateNested()` plus `@Type(() => ChildDto)` from `class-transformer`.
  Arrays of DTOs in the body need `@Body(new ParseArrayPipe({ items: CreateCourseDto }))`.
- Query values arrive as strings. In a query DTO, convert with `@Type(() => Number)` before
  `@IsInt()`. For single values use `ParseIntPipe`, `ParseBoolPipe`, `ParseUUIDPipe`.
- A failed validation returns `400` with `message: string[]` (e.g. `"code must be a string"`).
  v1 returned `{ error: { message: "Validation failed", details: [{ path, message }] } }`
  (see `../acadpath/backend/src/libs/appErr.ts`). To keep that contract, use the pipe's
  `exceptionFactory` option plus an exception filter, and say so, because it changes the API shape.
- Docs: https://docs.nestjs.com/application/validation.md, https://github.com/typestack/class-validator

### Guards and authorization

```ts
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    // verify the session/token, attach the user, or throw UnauthorizedException
  }
}
```

- Port the v1 auth flow (cookies, token format, expiry) exactly. Read `../acadpath/backend` first.
- Before adding Passport or writing JWT handling by hand, check the first-party
  `@nestjs/authentication` and `@nestjs/authorization` packages that `AGENTS.md` lists.
- Admin rights come from the server-side user record, never from the request body or headers.
- A student endpoint scopes every query by the authenticated user's id. Never take that id from a
  path or body parameter for "my" resources.
- Use `APP_GUARD` (from `@nestjs/core`) in a module's `providers` to apply a guard globally, with a
  `@Public()` metadata decorator to opt routes out.

### Errors

Throw Nest's built-in HTTP exceptions (`NotFoundException`, `ForbiddenException`,
`ConflictException`, …) from providers. Add a global exception filter only to match v1's error
shape or to stop internal details from leaking. Never return stack traces or raw database errors.

### Unit tests (Vitest)

```ts
import { Test } from '@nestjs/testing';
import { CoursesService } from './courses.service.js';
import { CoursesController } from './courses.controller.js';

describe('CoursesController', () => {
  const coursesService = { findOne: vi.fn() };
  let controller: CoursesController;

  beforeEach(async () => {
    vi.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [CoursesController],
      providers: [{ provide: CoursesService, useValue: coursesService }],
    }).compile();
    controller = moduleRef.get(CoursesController);
  });

  it('returns the course from the service', async () => {
    coursesService.findOne.mockResolvedValue({ id: 'c1' });
    await expect(controller.findOne('c1')).resolves.toEqual({ id: 'c1' });
  });
});
```

- Test the guards for the "another student's record" case and the "non-admin" case.
- E2E tests (`test/*.e2e-spec.ts`) use `supertest` against `app.getHttpServer()`. Register the
  same global pipes, guards, and filters as `main.ts`, or the test exercises a different app.
- Mock AI providers and external sites. Never make real paid AI calls in tests.

## Academic data rules (backend side)

- GPA, credit totals, and prerequisite checks are deterministic code with unit tests, never LLM
  output.
- Validate AI output against a class-validator DTO (`plainToInstance` + `validate`). If a field is missing or invalid, store it as unknown or
  needs-review. Never guess a value.
- Keep provenance (source URL or document, extraction time, verification status) alongside the
  extracted data.
- What-if scenarios never write to the student's real record.

## Checks before reporting done

Run these from `backend/` and report what actually ran:

```sh
pnpm lint
pnpm test
pnpm test:e2e
pnpm build
```

Then explain what changed, which Nest concepts were introduced (with docs links), how this
compares to the v1 Express version, and the limitations and follow-ups.
