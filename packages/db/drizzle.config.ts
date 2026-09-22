import { defineConfig } from 'drizzle-kit';

// drizzle-kit is a standalone CLI tool (like eslint.config.js or vitest.config.ts),
// not application runtime code, so it reads process.env directly rather than going
// through @aivoryx/config — the same exception every other *.config.ts file has.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/aivoryx',
  },
});
