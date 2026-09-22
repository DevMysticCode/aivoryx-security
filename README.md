# Aivoryx Security

Application security assessment platform — monorepo.

**Status:** Batch 4 (Security Engine Foundation) complete. Human identity, the full
Project → Asset → Assessment → AssessmentJob domain model, an explicit assessment
scope, SSRF protection, a DNS-rebinding-resistant safe HTTP client, a scanner
plugin architecture, and one non-invasive scanner (HTTP reachability) are
implemented — `apps/worker` now actually executes assessments end to end. **No
vulnerability detection/exploitation, crawling, or mobile scanning exists yet** —
see [docs/security-model.md](docs/security-model.md) for what's implemented versus
still future.

## Structure

```
/apps
  web             React + Vite + TypeScript frontend (placeholder shell)
  api             Fastify HTTP API — auth, organizations/members, projects, assets, assessments, api-keys
  worker          BullMQ worker — assessment-orchestration/assessment-jobs consumers (placeholder processing)
  report-worker   BullMQ worker — report-generation consumer (placeholder processing)
/packages
  shared-types    Domain enums/types shared across apps: AssetType, AssessmentType,
                  AssessmentStatus, AssessmentJobStatus, compatibility/transition rules
  config          Zod-based env-var schema/config loader
  logger          Structured logging (pino), secret redaction
  db              Drizzle ORM schema, migrations, database client, audit service
  queue           BullMQ/Redis queue infrastructure
  auth            Authentication/authorization primitives: principals, roles,
                  permissions, password hashing (Argon2id), session tokens, API-key
                  crypto — no scanner/business logic
  billing         Provider-agnostic billing domain: plan catalog, seat math,
                  BillingProvider interface (no live payment integration)
  scanner-core    ScannerPlugin interface, AssessmentScope/SSRF validation,
                  DNS-rebinding-resistant SafeHttpClient, finding deduplication
  scanners        Individual scanner plugin packages: http-reachability (Batch 4)
  ai-core         AIProvider interface + providers (optional, not wired in yet)
  report-core     HTML/PDF report templating
/infrastructure
  docker          docker-compose.yml — local PostgreSQL + Redis
/docs
  architecture.md     System overview, domain model, package/app responsibilities
  authorization.md    Platform vs. tenant identity, human + API-key auth, roles, permissions
  billing.md          Plans, subscriptions, seats, payments
  security-model.md   Asset authorization/assessment-compatibility model (implemented vs. future)
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
- [docs/security-model.md](docs/security-model.md) — assessment authorization/scope model, SSRF protections, and the scanner pipeline (implemented vs. future)
