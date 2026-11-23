// Config for the Prisma CLI (generate, migrate, studio). The running app does not read it.
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // process.env instead of Prisma's env() helper so `prisma generate` (build, CI)
    // works without a database URL. Migrations still need one.
    url: process.env.DATABASE_URL ?? '',
  },
});
