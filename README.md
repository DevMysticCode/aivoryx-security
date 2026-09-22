# Aivoryx Security

Application security assessment platform — monorepo.

**Status:** Batch 2 (Identity, Tenancy, Authorization, Commercial Foundation & Audit) complete.
Real scanning/assessment functionality has not been implemented yet — see
[docs/security-model.md](docs/security-model.md) for the planned future model.

## Structure

```
/apps
  web             React + Vite + TypeScript frontend (placeholder shell)
  api             Fastify HTTP API — health/readiness, auth, organizations/projects/api-keys
  worker          BullMQ worker — assessment-orchestration/assessment-jobs consumers (placeholder processing)
  report-worker   BullMQ worker — report-generation consumer (placeholder processing)
/packages
  shared-types    Types shared across apps
  config          Zod-based env-var schema/config loader
  logger          Structured logging (pino), secret redaction
  db              Drizzle ORM schema, migrations, database client, audit service
  queue           BullMQ/Redis queue infrastructure
  auth            Authentication/authorization primitives: principals, roles,
                  permissions, API-key crypto — no scanner/business logic
  billing         Provider-agnostic billing domain: plan catalog, seat math,
                  BillingProvider interface (no live payment integration)
  scanner-core    ScannerPlugin interface, SafeHttpClient, orchestration primitives
  scanners        Individual scanner plugin packages (none yet)
  ai-core         AIProvider interface + providers (optional, not wired in yet)
  report-core     HTML/PDF report templating
/infrastructure
  docker          docker-compose.yml — local PostgreSQL + Redis
/docs
  architecture.md     System overview and package/app responsibilities
  authorization.md    Platform vs. tenant identity, roles, permissions, API keys
  billing.md          Plans, subscriptions, seats, payments
  security-model.md   The future assessment authorization/scope model
```

## Requirements

- Node.js 20+ (see `.nvmrc`)
- pnpm 11+ (`corepack enable` recommended)
- Docker (for local PostgreSQL/Redis — see `infrastructure/docker`)

## Getting started

```bash
cp .env.example .env        # fill in JWT_SECRET / CREDENTIAL_MASTER_KEY for local dev
pnpm install
pnpm infra:up                # starts PostgreSQL + Redis
node --env-file=.env packages/db/dist/migrate-cli.js   # after: pnpm --filter @aivoryx/db build
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm format:check
```

## Development commands

| Command                        | Description                                       |
| ------------------------------ | ------------------------------------------------- |
| `pnpm build`                   | Build all apps/packages via Turborepo             |
| `pnpm dev`                     | Run all apps in dev/watch mode                    |
| `pnpm lint`                    | Lint all apps/packages via ESLint                 |
| `pnpm typecheck`               | Type-check all apps/packages                      |
| `pnpm test`                    | Run unit tests (no external services required)    |
| `pnpm format` / `format:check` | Format (or check formatting) with Prettier        |
| `pnpm infra:up`                | Start local PostgreSQL + Redis via Docker Compose |
| `pnpm infra:down`              | Stop and remove local infrastructure containers   |
| `pnpm infra:logs`              | Tail logs from local infrastructure containers    |

Integration tests that require a live database/Redis are gated behind env vars and
excluded from `pnpm test` — see `packages/db/README.md`, `packages/queue/README.md`,
and `apps/api/package.json`'s `test:integration` script.

## Documentation

- [docs/architecture.md](docs/architecture.md) — system overview
- [docs/authorization.md](docs/authorization.md) — platform vs. tenant identity, roles/permissions, API keys, tenant isolation
- [docs/billing.md](docs/billing.md) — plans, subscriptions, seats, payments
- [docs/security-model.md](docs/security-model.md) — the future assessment authorization/scope model (not implemented yet)
