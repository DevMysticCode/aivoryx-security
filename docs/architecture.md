# Architecture

## System overview

```
React frontend (apps/web)
        │ HTTPS (session cookie or API key)
        ▼
Fastify API (apps/api)  ──────────────▶ PostgreSQL (packages/db)
        │  enqueue AssessmentJob                ▲
        ▼                                        │ read/write
Redis / BullMQ (packages/queue)                  │
        │                                        │
        ├──▶ apps/worker (assessment-orchestration, assessment-jobs)
        └──▶ apps/report-worker (report-generation)
```

Batch 1 established the runnable skeleton of this diagram: config, logging, the
database/queue clients, health/readiness checks, and process lifecycle. Batch 2 added
the identity/tenancy/billing foundation (organizations, membership, API keys, audit).
Batch 3 added real human authentication and the security-assessment domain model
(projects → assets → assessments → assessment jobs). Batch 4 adds the first real
scanner engine: an explicit assessment scope, SSRF protection, a DNS-rebinding-
resistant safe HTTP client, a scanner plugin architecture, and one non-invasive HTTP
reachability scanner — `apps/worker` now actually executes assessments end to end
(QUEUED → RUNNING → COMPLETED/FAILED) instead of only logging and acknowledging. See
[security-model.md](security-model.md) for the full detail.

## Domain model

```
Organization
  └── Project                (packages/db: projects)
        └── Asset             (assets — WEB | API | ANDROID | IOS)
              ├── AssetBuild   (asset_builds — mobile build metadata only, no binaries)
              └── Assessment   (assessments — WEB | API | ANDROID_STATIC | ANDROID_DYNAMIC | IOS_STATIC | IOS_DYNAMIC; carries an immutable `scope` snapshot)
                    ├── AssessmentJob  (assessment_jobs — the row a BullMQ job id points back to)
                    └── Finding        (findings — one per deduplicated scanner observation)
                          └── Evidence (evidence — sanitized, size-capped request/response metadata)
```

- **Asset type determines valid assessment types** —
  `packages/shared-types/src/assessments.ts`'s `ASSET_TYPE_ASSESSMENT_COMPATIBILITY`
  is the single source of truth (e.g. an `ANDROID` asset can never take a `WEB`
  assessment); `apps/api/src/services/assessments.ts` enforces it before insert.
- **An asset must have `authorizationConfirmed = true` before any assessment can be
  created against it** — the security boundary described in
  [security-model.md](security-model.md), enforced in the same service method.
- **Assessment lifecycle** is a small state machine
  (`packages/shared-types`'s `canTransitionAssessmentStatus`):
  `QUEUED → RUNNING → COMPLETED | FAILED | CANCELLED` (or `QUEUED → CANCELLED`
  directly). `QUEUED → CANCELLED` is reachable via the API
  (`POST /assessments/:id/cancel`); `QUEUED → RUNNING → COMPLETED/FAILED` is driven
  entirely by `apps/worker` (Batch 4) — the API never allows an arbitrary status
  write.

## Package/app responsibilities

| Package/app             | Owns                                                                                                                                                                                                                                                                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/config`       | Env-var schema/validation, the single `AppConfig` shape. No other module reads `process.env` directly.                                                                                                                                                                                                                                    |
| `packages/logger`       | Structured (pino) logging with secret redaction.                                                                                                                                                                                                                                                                                          |
| `packages/shared-types` | Domain enums/types shared across apps/packages: `AssetType`, `AssessmentType`, `AssessmentStatus`, `AssessmentJobStatus`, the asset/assessment compatibility matrix, and the status-transition rules — the single source of truth so these strings are never duplicated across `packages/db`, `apps/api`, and (eventually) `apps/worker`. |
| `packages/db`           | Drizzle schema, migrations, database client, and the audit-event write service (`createAuditService`).                                                                                                                                                                                                                                    |
| `packages/queue`        | Redis connection, BullMQ queue/worker factories, typed job payloads. No business logic.                                                                                                                                                                                                                                                   |
| `packages/auth`         | Authentication/authorization **primitives only**: principal types, roles, permissions, the role→permission table, password hashing (Argon2id), session-token crypto, API-key crypto. No database access, no HTTP, no domain logic — see [authorization.md](authorization.md).                                                             |
| `packages/billing`      | Provider-agnostic billing **domain types and pure functions**: plan catalog, seat-usage math, the `BillingProvider` interface. Untouched in Batch 3 beyond what Batch 2 already established — see [billing.md](billing.md).                                                                                                               |
| `apps/api`              | HTTP concerns: routing, request validation (zod), the dual session/API-key auth context, and the service layer (`apps/api/src/services/*`) that combines authorization checks with `packages/db` queries and `packages/queue` enqueues. **Never makes a target HTTP request itself.**                                                     |
| `packages/scanner-core` | The scanner plugin framework (Batch 4): `ScannerPlugin`/`ScannerContext`, `AssessmentScope` validation, SSRF policy, the DNS-rebinding-resistant `SafeHttpClient`, finding-fingerprint deduplication. No database access, no HTTP server.                                                                                                 |
| `packages/scanners/*`   | Individual scanner plugins. Only `http-reachability` exists (Batch 4) — see [security-model.md](security-model.md).                                                                                                                                                                                                                       |
| `apps/worker`           | Consumes `assessment-jobs`, loads authoritative state from `packages/db`, selects and runs applicable scanner plugins via `packages/scanner-core`, persists findings/evidence. The only app that makes outbound requests to a target.                                                                                                     |
| `apps/report-worker`    | BullMQ consumer and process lifecycle. Still placeholder job processing — no report generation yet.                                                                                                                                                                                                                                       |

### Why the service layer lives in `apps/api`, not `packages/db`

`packages/db` stays a thin schema/client package on purpose — it has no opinions about
authorization or business rules. The service functions (`apps/api/src/services/*.ts`)
are where a Drizzle query, an authorization check, a domain rule (compatibility,
authorization-confirmed, status transitions), and an audit-log write are composed
together. This keeps `packages/db` reusable by any future app without inheriting
apps/api's authorization assumptions, while keeping `packages/auth` fully
persistence-agnostic.

## Data flow for a typical authenticated request

1. `apps/api`'s `registerAuthContext` (an `onRequest` hook) reads either the
   `Authorization` header (API key) or the session cookie, populating
   `request.principal` and/or `request.userId` — see [authorization.md](authorization.md).
2. A route handler calls `requireAnyIdentity(request)` (401 if neither mechanism
   produced an identity).
3. The service resolves a `TenantPrincipal` scoped to the specific organization the
   request targets — either matching an API key's inherent org, or looking up the
   session user's membership role in that org
   (`resolveTenantPrincipalForOrganization`) — then checks the specific permission it
   needs (`requirePermission(principal, 'asset:create')`) before touching data.
4. Domain rules (asset/assessment-type compatibility, authorization-confirmed,
   status-transition validity) are checked next, throwing `DomainError` with an
   appropriate status code on violation.
5. Mutations call `audit.record(...)` (`packages/db`'s `createAuditService`), which
   redacts secret-shaped metadata keys before writing.

## Control plane vs. scanner plane (Part Y)

`apps/api` (control plane) owns authentication, authorization, and the
project/asset/assessment domain — it decides _whether_ an assessment may run and
_what scope_ it's allowed, but never makes a request to a target itself.
`apps/worker` (scanner plane) owns target network access, scope/SSRF enforcement,
scanner execution, and finding/evidence generation — it never makes an
authorization decision the API hasn't already made (it re-checks
`authorizationConfirmed` defensively, but never grants access the API denied). This
separation is mandatory: it means a bug in scanner code can never accidentally skip
an authentication/authorization check, and a bug in the API can never accidentally
issue an unscoped outbound request.

## What is deliberately not implemented yet

- Vulnerability detection/exploitation of any kind, crawling, browser automation/JS
  execution, API fuzzing/OpenAPI-driven testing, mobile scanning, report
  generation, AI — see
  [security-model.md](security-model.md) for the authorization/scope model that will
  govern the scanner once it exists.
- Live billing-provider integration (Stripe or otherwise) — `packages/billing`
  defines the interface a future adapter implements; untouched in Batch 3.
- Email delivery — registration/login work without email verification; the
  "invite an unregistered email" flow is deferred (see
  [authorization.md](authorization.md)'s membership section).
- Object storage for mobile builds — `asset_builds` is metadata-only (Part G);
  `storage_key` is an abstract reference a future S3-compatible backend will resolve.
