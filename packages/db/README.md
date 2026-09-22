# @aivoryx/db

PostgreSQL client and migration infrastructure, built on [Drizzle ORM](https://orm.drizzle.team/)
and [postgres.js](https://github.com/porsager/postgres). No domain tables exist yet — `src/schema.ts`
is intentionally empty until a later batch introduces the domain model.

## Why Drizzle

Drizzle was chosen over Prisma for this monorepo because it's a thin, strongly-typed layer directly
over SQL with no generated client/runtime engine binary to manage — a better fit for a worker process
that needs to start quickly and a schema that will grow incrementally across many future batches.

## Usage

```typescript
import { createDbClient } from '@aivoryx/db';
import { getConfig } from '@aivoryx/config';

const config = getConfig();
const { db, healthCheck, close } = createDbClient(config.database.url);

await healthCheck(); // { healthy: true, latencyMs: 3 }
await close();
```

Connecting is lazy: `createDbClient` never throws for an unreachable database — only
`healthCheck()` or an actual query will.

## Migrations

```bash
pnpm --filter @aivoryx/db db:generate   # generate a migration from schema.ts changes
pnpm --filter @aivoryx/db build && pnpm --filter @aivoryx/db db:migrate  # apply migrations
```

`migrations/` currently has zero migrations (an empty journal) — `runMigrations()` is a safe no-op
until the first domain schema lands.

## Tests

```bash
pnpm --filter @aivoryx/db test               # unit tests, no external services required
```

Integration tests require a live PostgreSQL instance:

```bash
pnpm infra:up
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/aivoryx \
  pnpm --filter @aivoryx/db test:integration
```
