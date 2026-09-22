# Architecture

## System overview

```
React frontend (apps/web)
        │ HTTPS
        ▼
Fastify API (apps/api)  ──────────────▶ PostgreSQL (packages/db)
        │  enqueue jobs                        ▲
        ▼                                       │ read/write
Redis / BullMQ (packages/queue)                  │
        │                                        │
        ├──▶ apps/worker (assessment-orchestration, assessment-jobs)
        └──▶ apps/report-worker (report-generation)
```

Batch 1 established the runnable skeleton of this diagram: config, logging, the
database/queue clients, health/readiness checks, and process lifecycle. Batch 2 adds
the first real domain model and the identity/authorization layer everything else in
the product depends on. No scanning, crawling, or report-generation logic exists yet.

## Package/app responsibilities

| Package/app                          | Owns                                                                                                                                                                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/config`                    | Env-var schema/validation, the single `AppConfig` shape. No other module reads `process.env` directly.                                                                                                                                                  |
| `packages/logger`                    | Structured (pino) logging with secret redaction.                                                                                                                                                                                                        |
| `packages/db`                        | Drizzle schema, migrations, database client, and the audit-event write service (`createAuditService`) — it owns the table the service writes to.                                                                                                        |
| `packages/queue`                     | Redis connection, BullMQ queue/worker factories, typed job payloads. No business logic.                                                                                                                                                                 |
| `packages/auth`                      | Authentication/authorization **primitives only**: principal types, roles, permissions, the role→permission table, API-key crypto (generate/hash/verify/parse). No database access, no HTTP, no domain logic — see [authorization.md](authorization.md). |
| `packages/billing`                   | Provider-agnostic billing **domain types and pure functions**: plan catalog, seat-usage math, the `BillingProvider` interface a future Stripe adapter implements. No network calls, no persistence — see [billing.md](billing.md).                      |
| `apps/api`                           | HTTP concerns: routing, request validation (zod), wiring `packages/auth`'s primitives into a real per-request `principal`, and the service layer (`apps/api/src/services/*`) that combines authorization checks with `packages/db` queries.             |
| `apps/worker` / `apps/report-worker` | BullMQ consumers and process lifecycle. Still placeholder job processing (Batch 1 scope) — no scanning or report generation.                                                                                                                            |

### Why the service layer lives in `apps/api`, not `packages/db`

`packages/db` stays a thin schema/client package on purpose — it has no opinions about
authorization or business rules. The organizations/projects/api-keys service functions
(`apps/api/src/services/*.ts`) are where a Drizzle query, an authorization check
(`requirePermission`, tenant scoping), and an audit-log write are composed together.
This keeps `packages/db` reusable by any future app (a CLI, an admin tool) without
those apps inheriting apps/api's authorization assumptions, while keeping
`packages/auth` fully persistence-agnostic (it depends on nothing else in the monorepo).

## Data flow for a typical authenticated request

1. `apps/api`'s `registerAuthContext` (an `onRequest` hook) reads the `Authorization`
   header on every request and, if present, calls `packages/auth`'s
   `verifyApiKeyCredential`, looking up the candidate row via `packages/db`. The result
   becomes `request.principal` (or `null`) — see [authorization.md](authorization.md).
2. A route handler calls `requireAuthenticated(request)` (401 if `null`), then
   `requireTenant(principal)` where a tenant-scoped principal is required.
3. The service function checks the specific permission it needs
   (`requirePermission(principal, 'project:create')`) before touching the database, and
   scopes every query to `principal.organizationId` — never a client-supplied org id.
4. Mutations call `audit.record(...)` (`packages/db`'s `createAuditService`), which
   redacts secret-shaped metadata keys before writing.

## What is deliberately not implemented yet

- Real human user authentication (login, sessions, OAuth) — only API-key
  (machine) authentication exists. See [authorization.md](authorization.md) for what
  this does and doesn't make possible.
- Live billing-provider integration (Stripe or otherwise) — `packages/billing`
  defines the interface a future adapter implements.
- Assessment/scanning/finding functionality — see [security-model.md](security-model.md)
  for the model that will govern it once it's built.
