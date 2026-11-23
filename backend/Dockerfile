# syntax=docker/dockerfile:1

ARG NODE_VERSION=24
ARG PNPM_VERSION=12.15.0

# Debian (glibc), not Alpine (musl): Playwright's Chromium, used by the student-portal
# browser, only runs on glibc.

# ---- base: node + pnpm ----
FROM node:${NODE_VERSION}-bookworm-slim AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# Where Playwright keeps its browser: outside /root, so the node user can run it.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npm install -g pnpm@${PNPM_VERSION}
WORKDIR /app

# ---- deps: all dependencies (for building) ----
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# ---- dev: watch mode, used by docker-compose.dev.yml (Compose Watch syncs src/) ----
FROM deps AS dev
ENV NODE_ENV=development
# Headless Chromium and the system libraries it needs (runs as root, before USER).
RUN node_modules/.bin/playwright install --with-deps --only-shell chromium
COPY --chown=node:node . .
RUN pnpm prisma:generate
# nest writes dist/ into /app, so the node user must own it
RUN chown node:node /app
USER node
ENV PORT=4000
EXPOSE 4000
CMD ["node_modules/.bin/nest", "start", "--watch"]

# ---- build: compile TypeScript ----
FROM deps AS build
COPY . .
RUN pnpm build

# ---- prod-deps: runtime dependencies only ----
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --prod

# ---- runner ----
FROM node:${NODE_VERSION}-bookworm-slim AS runner
ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
# Headless Chromium (the version this Playwright expects) and its system libraries.
RUN node_modules/.bin/playwright install --with-deps --only-shell chromium \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
USER node
ENV PORT=4000
EXPOSE 4000
CMD ["node", "dist/main.js"]
