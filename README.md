# AcadPath v2

AcadPath is an academic-planning platform for university students and administrators, starting with
Lebanese International University (LIU). Students import their transcript, see their progress and GPA,
plan upcoming semesters, run what-if scenarios, and find learning resources for difficult courses.
Admins manage universities, majors, course catalogs, and source documents.

This repository is the second version of AcadPath. It rebuilds the original app on a new stack:

| Layer    | v1 (`../acadpath`)          | v2 (this repo)                 |
| -------- | --------------------------- | ------------------------------ |
| Frontend | React + Vite + React Router | Next.js 16 (App Router)        |
| Backend  | Express 5                   | NestJS 12                      |
| Tests    | Jest / Vitest               | Vitest (both apps)             |
| Deploy   | Vercel + Render             | Docker images + Docker Compose |

> **Status:** early scaffold. Both apps currently contain only the starter code, tests, Docker
> setup, and CI. Features are being ported from v1 one module at a time.

## Repository layout

```
.
├── backend/              NestJS API (ESM, Vitest, oxlint)
├── frontend/             Next.js app (App Router, Tailwind CSS 4, React Compiler, Vitest)
├── docker-compose.yml    Runs both apps against an external PostgreSQL database
├── docker-compose.dev.yml  Dev override: dev servers + Compose Watch
├── .env.example          Variables used by Docker Compose
└── .github/workflows/    CI: lint, test, build, Docker build for both apps
```

Each app is its own pnpm project with its own lockfile. There is no root `package.json`.

## Requirements

- Node.js 24
- pnpm 12.15.0
- Docker (optional, for the Compose setup)
- A PostgreSQL database (for example Neon)

## Local development

Backend (runs on port 3000 by default, so set `PORT` to keep it off the Next.js port):

```sh
cd backend
pnpm install
PORT=4000 pnpm start:dev
```

Frontend:

```sh
cd frontend
pnpm install
NEXT_PUBLIC_API_URL=http://localhost:4000 pnpm dev   # http://localhost:3000
```

## Running with Docker Compose

```sh
cp .env.example .env      # then fill in DATABASE_URL
docker compose up --build
```

| Variable              | Used by  | Purpose                                                       |
| --------------------- | -------- | ------------------------------------------------------------- |
| `DATABASE_URL`        | backend  | PostgreSQL connection string                                  |
| `BACKEND_PORT`        | compose  | Host port for the API (default `4000`)                        |
| `FRONTEND_PORT`       | compose  | Host port for the web app (default `3000`)                    |
| `NEXT_PUBLIC_API_URL` | frontend | API URL used by the browser. Inlined at **build** time.       |

Inside the Compose network, server-side Next.js code reaches the API at `http://backend:4000`
through `API_URL`.

### Development with watch mode

`docker-compose.dev.yml` layers [Compose Watch](https://docs.docker.com/compose/file-watch/) on
top of the base file. It builds the `dev` stage of each Dockerfile (`nest start --watch` and
`next dev`) instead of the production image:

```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --watch
# or, to keep sync events out of the app logs:
docker compose -f docker-compose.yml -f docker-compose.dev.yml watch
```

| Change                                                    | What happens                              |
| --------------------------------------------------------- | ----------------------------------------- |
| `backend/src/**`, `frontend/src/**`, `frontend/public/**` | Synced into the container, dev server reloads |
| `tsconfig*.json`, `nest-cli.json`, `next.config.ts`       | Synced, then the container restarts       |
| `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`   | Image is rebuilt and the container recreated |

Dev images are tagged `:dev`, so they don't replace the production `:latest` images. Requires
Docker Compose 2.32 or later.

## Scripts

Backend (`backend/`):

| Command          | What it does                     |
| ---------------- | -------------------------------- |
| `pnpm start:dev` | Start in watch mode              |
| `pnpm build`     | Compile to `dist/`               |
| `pnpm start:prod`| Run the compiled build           |
| `pnpm lint`      | oxlint (type-aware)              |
| `pnpm test`      | Unit tests (`src/**/*.spec.ts`)  |
| `pnpm test:e2e`  | End-to-end tests (`test/`)       |
| `pnpm format`    | Prettier                         |

Frontend (`frontend/`):

| Command      | What it does                         |
| ------------ | ------------------------------------ |
| `pnpm dev`   | Start the dev server                 |
| `pnpm build` | Production build (standalone output) |
| `pnpm start` | Serve the production build           |
| `pnpm lint`  | ESLint                               |
| `pnpm test`  | Vitest + React Testing Library       |

## Continuous integration

`.github/workflows/ci.yml` runs on pushes to `main` and on every pull request:

1. **Backend:** install, lint, unit tests, e2e tests, build.
2. **Frontend:** install, lint, tests, build.
3. **Docker:** builds both images (no push) once the two jobs above pass.

## Feature roadmap (ported from v1)

- Authentication with access and refresh tokens, student and admin roles
- University, major, and course catalog management, including prerequisites
- Course extraction from university web pages and PDFs, with source tracking
- Onboarding: transcript import (file upload and the live student-portal browser)
- Academic profile, GPA, and academic records
- Semester planning and the full study plan through graduation
- What-if analysis
- AI advisor, learning-resource recommendations, and quizzes
- Object storage for student documents
