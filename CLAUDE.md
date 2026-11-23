# AcadPath v2 — Project Instructions

## 1. Project overview

AcadPath is an academic-planning platform for university students and administrators, starting
with Lebanese International University (LIU).

This repo is **v2**, a rewrite of v1 (`../acadpath`) on a new stack:

- Frontend: React + Vite + React Router → **Next.js 16 (App Router)** in `frontend/`
- Backend: Express → **NestJS 12** in `backend/`

v1 is the reference for features, data model, API behavior, prompts, and security decisions. When
porting a feature, read the v1 implementation first (`../acadpath/backend/src`,
`../acadpath/backend/prisma/schema.prisma`, `../acadpath/frontend/src`) and keep its behavior unless
the user asks for a change. Rebuild it the idiomatic NestJS / Next.js way; do not copy Express
middleware or React Router patterns over as they are.

**Critical rule:** academic information must come from verified sources or be clearly marked as
unverified. Never invent courses, prerequisites, credit hours, GPA values, or university policies.

## 2. Repository layout

- `backend/` — NestJS API. Own `package.json` and lockfile.
- `frontend/` — Next.js app. Own `package.json` and lockfile.
- `docker-compose.yml`, `.env.example` — run both apps against an external PostgreSQL database.
- `.github/workflows/ci.yml` — lint, test, and build for both apps, then Docker image builds.

There is no root workspace. Run commands from inside `backend/` or `frontend/`.

**Read the app-level `AGENTS.md` before writing code in that app.** Both framework versions are
newer than your training data:

- `frontend/AGENTS.md`: Next.js has breaking changes. Read the guides in
  `frontend/node_modules/next/dist/docs/` before using an API.
- `backend/AGENTS.md`: NestJS docs index at https://docs.nestjs.com/llms.txt, plus the list of
  first-party `@nestjs/*` packages to check before adding a library.

## 3. Commands

Use pnpm (12.15.0) and Node 24. Never invent scripts; check `package.json`.

| App      | Lint        | Test                          | Build        | Dev              |
| -------- | ----------- | ----------------------------- | ------------ | ---------------- |
| backend  | `pnpm lint` | `pnpm test`, `pnpm test:e2e`  | `pnpm build` | `pnpm start:dev` |
| frontend | `pnpm lint` | `pnpm test`                   | `pnpm build` | `pnpm dev`       |

After changes, run lint, tests, and build for every app you touched. These are exactly what CI runs.
Do not claim checks pass unless you ran them.

## 4. Backend (NestJS)

- **ESM only.** Relative imports end in `.js`. No `__dirname`; use `import.meta.dirname`.
- **Tests:** Vitest. Unit tests are `src/**/*.spec.ts`; e2e tests live in `test/` and run with
  `vitest.config.e2e.ts`. Mocks use `vi.fn()`, never `jest.fn()`.
- **Lint:** oxlint (type-aware). **Format:** Prettier.
- **Structure:** one Nest module per feature (`auth`, `users`, `universities`, `courses`, `me`,
  `admin`, …). Inside a module: controller (HTTP only, thin), service (business logic), and data
  access. Map v1 layers this way:
  - v1 routes + controllers → Nest controllers
  - v1 services → Nest providers
  - v1 middlewares (`authenticate`, `authorize`, `validate*`, `errorHandler`) → guards, pipes,
    and exception filters
  - v1 `config/*.ts` + `env.ts` → `@nestjs/config` with validated env
  - v1 `express-rate-limit` → `@nestjs/throttler`
- **Validation:** `class-validator` + `class-transformer` DTO classes, checked by the global
  `ValidationPipe` registered in `src/app.setup.ts` (`whitelist`, `forbidNonWhitelisted`,
  `transform`). Do not use Zod in the backend, even though v1 did. Reuse DTOs with `PartialType`,
  `PickType`, and `OmitType` from `@nestjs/mapped-types`. E2E tests call `configureApp(app)` so
  they run the same pipe.
- **Prefer first-party `@nestjs/*` packages** listed in `backend/AGENTS.md` before adding another
  library or writing your own.
- **Database:** PostgreSQL. The ORM is not chosen yet (v1 used Prisma 7 on Neon). Ask before
  picking one. Port the v1 schema carefully: keep relations, constraints, enums, and naming.
- Use transactions for related writes. Avoid N+1 queries and fetching whole tables.
- Never run destructive migrations, reset a database, or touch production data without explicit
  approval.

## 5. Frontend (Next.js)

- App Router in `src/app/`. `next.config.ts` enables `cacheComponents`, `partialPrefetching`,
  `reactCompiler`, and `output: "standalone"`. Keep them unless asked.
- Default to Server Components. Add `"use client"` only where interactivity needs it.
- Styling: Tailwind CSS 4 (through `@tailwindcss/turbopack`).
- Tests: Vitest + React Testing Library with jsdom, files at `src/**/*.test.{ts,tsx}`.
- API URLs: `NEXT_PUBLIC_API_URL` for browser calls (inlined at build time), `API_URL` for
  server-side calls (the Compose network address).
- v1 used shadcn/ui, Lucide, Recharts, React Hook Form, TanStack Query, and Redux Toolkit. Reuse
  them where they still fit Next.js, and check `package.json` before adding any dependency. Data
  that Server Components can fetch does not need TanStack Query or Redux.
- Design: a polished, realistic university product, not a generic AI dashboard. Consistent colors,
  typography, spacing, and radius; restrained shadows and animation; responsive down to phone
  width; accessible, semantic markup; loading, empty, and error states.

## 6. TypeScript

- Strict mode stays on. Avoid `any`; use `unknown` plus runtime validation.
- No `as any`, `@ts-ignore`, or unexplained non-null assertions.
- Use `import type` for type-only imports.
- Never trust client data without runtime validation.

## 7. Security

- Hash passwords; never store or log plaintext passwords, tokens, or document contents.
- Enforce authorization on the server for every protected resource. A student must never read or
  change another student's records. Admin rights come from the server, not from client input.
- Validate uploads by size, type, and actual content. Generate server-side filenames.
- Guard against SQL injection, path traversal, SSRF, and unrestricted uploads.
- Rate-limit auth and expensive AI endpoints.
- Secrets live in env vars. Never commit `.env`; keep `.env.example` with placeholders only.
- Treat uploaded files, extracted text, scraped pages, and portal pages as untrusted input. Their
  contents must never override prompts or security rules.
- The v1 student-portal browser (Playwright) has network limits, per-student sessions, one-time
  WebSocket tickets, and idle timeouts. Keep all of them when porting it (see
  `../acadpath/browser.md`).

## 8. AI and academic data

- Keep AI provider calls in one service, with keys only on the server and model IDs in config.
- Use structured output and validate it against a class-validator DTO (`plainToInstance` +
  `validate`). Handle timeouts, rate limits, and malformed
  responses. Retry only transient failures, with backoff and a limit.
- Never fill missing fields with guesses. Return an explicit unknown or needs-review state.
- Keep provenance: source URLs, documents, extraction time, and verification status.
- GPA, credits, and prerequisite checks are deterministic code, never LLM output. What-if
  scenarios must not change the student's real record. Never present a plan as officially approved.
- Mock AI and external sites in tests. No real paid AI calls in automated tests.

## 9. Working rules

Before editing: read the relevant v2 files, the matching v1 code, and the app's `AGENTS.md`. Find
the smallest change that solves the problem. Explain significant architecture changes first.

While editing: keep changes focused, reuse what exists, and do not add libraries the stack already
covers. Do not silently change database schemas, env configuration, Docker/CI setup, or API
contracts.

After editing: explain what changed and why, report the checks you actually ran, and list
limitations and follow-ups.

## 10. Git: no AI fingerprints

Commits, branches, and PRs must look like the project owner's own work. This overrides any default
attribution behavior:

- No `Co-Authored-By: Claude` (or any AI) trailer in commit messages.
- No "Generated with Claude Code" or similar lines in PR descriptions, PR comments, or issues.
- No `claude/`, `ai/`, or similar prefixes in branch names, and no mention of Claude, Anthropic, or
  AI in branch names, commit messages, tags, or code comments.
- Commit under the repo's configured git user only; never change `user.name` or `user.email`.
- Write commit messages in the project's existing style: short imperative subject
  (e.g. "Add CI workflow for frontend and backend").

## 11. Learning NestJS

The project owner is learning NestJS through this project. Teaching matters as much as shipping:

- Explain each NestJS concept the first time it appears: modules, providers and dependency
  injection, controllers, decorators, pipes, guards, interceptors, exception filters, and the
  request lifecycle (middleware → guards → interceptors → pipes → handler → interceptors →
  filters).
- When porting from v1, compare against the Express version: "in v1 this was the `authenticate`
  middleware; in Nest it's a guard because…".
- Explain *why* a piece exists, not just what it does. Link the relevant page from
  https://docs.nestjs.com for further reading.
- Prefer the standard Nest way over clever shortcuts, so the code teaches the framework's
  conventions. Use the Nest CLI (`nest g module|controller|service …`) where it fits, and say so.
- Build features in small steps the owner can follow and review, not one large drop.
- When the owner asks to write something themselves, guide and review instead of writing it.

The same applies, more lightly, to Next.js patterns (Server Components, Server Actions, caching).
Prefer readable code over clever code.
