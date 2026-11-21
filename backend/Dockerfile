# syntax=docker/dockerfile:1

ARG NODE_VERSION=24
ARG PNPM_VERSION=12.15.0

# ---- base: node + pnpm ----
FROM node:${NODE_VERSION}-alpine AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN npm install -g pnpm@${PNPM_VERSION}
WORKDIR /app

# ---- deps: all dependencies (for building) ----
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# ---- dev: watch mode, used by docker-compose.dev.yml (Compose Watch syncs src/) ----
FROM deps AS dev
ENV NODE_ENV=development
COPY --chown=node:node . .
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
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --prod

# ---- runner ----
FROM node:${NODE_VERSION}-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
USER node
ENV PORT=4000
EXPOSE 4000
CMD ["node", "dist/main.js"]
