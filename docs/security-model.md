# Security model for assessments

**Still no scanner, crawler, or outbound-target-request logic exists.** Batch 3
implements the _authorization and domain-model_ half of this document (Asset,
Authorization confirmation, Assessment, compatibility validation) — the sections
below are marked with what's real today versus what remains future work.

## The model

```
Project
  ↓
Asset                 what could be assessed (WEB | API | ANDROID | IOS)              ✅ implemented (Batch 3)
  ↓
Authorization          explicit, recorded confirmation the org is allowed to test it   ✅ implemented (Batch 3)
  ↓
Scope / Exclusions      exactly what is in-bounds vs. explicitly out-of-bounds         ❌ future — see below
  ↓
Assessment               a scheduled/queued run against an authorized asset            ✅ implemented (Batch 3, lifecycle only)
  ↓
Scanner                  the thing that actually makes requests                        ❌ not built; not even started
```

Each stage is a hard gate on the one below it, not a formality:

- **An asset existing is not authorization to assess it.** `assets.authorization_confirmed`
  defaults to `false`; adding an asset to a project records _what it is_, nothing more.
- **Authorization must be explicit and recorded** — `PATCH /assets/:id
{authorizationConfirmed: true}` records `authorization_confirmed_by` (the real user
  id, when session-authenticated) and `authorization_confirmed_at`, and is gated
  behind `asset:update`, deliberately withheld from the DEVELOPER role (see
  [authorization.md](authorization.md)'s separation-of-duties note) — the person who
  adds an asset for testing is not automatically trusted to attest the organization
  is authorized to have it assessed.
- **The API enforces this before an assessment can even be created**:
  `apps/api/src/services/assessments.ts`'s `create()` throws a 400 `DomainError`
  ("This asset does not have authorization confirmed for assessment") if
  `authorizationConfirmed !== true` — checked server-side, not just documented.
- **Asset type constrains assessment type** (`packages/shared-types`'s
  `ASSET_TYPE_ASSESSMENT_COMPATIBILITY`): `ANDROID + WEB` is rejected with 400 before
  any row is written. This is Part F's compatibility requirement — implemented and
  tested (`packages/shared-types/src/assessments.test.ts`,
  `apps/api/src/api.integration.test.ts`).
- **Scope is a positive allow-list** (specific hosts/paths/ports) and **exclusions
  override scope** — **not implemented yet.** Today, "authorized" is a single
  organization-level boolean per asset; it is not yet host/path/port-granular. A
  scanner must never be built to interpret `authorizationConfirmed: true` as "assess
  anything reachable from this asset's config" without that finer-grained scope model
  landing first — see the warning below.
- **An assessment is scoped to one asset at creation time** (`assessments.asset_id`,
  immutable) — not "whatever the project currently contains."
- **The scanner is the last, most restricted link in the chain** — not built yet, so
  this is still a forward-looking constraint, not an implemented one.

## What this guarantees will never happen (once a scanner exists)

A scanner must never be able to attack an arbitrary internet target just because a
user (or a compromised API key) supplied a URL somewhere. Concretely, this rules out:

- Treating "an asset row exists" as sufficient to assess it — `authorizationConfirmed`
  must be `true`, checked server-side (implemented).
- Treating "the user who added the asset" as automatically authorized to confirm it —
  separation of duties via `asset:update` (implemented).
- Assessing an asset type with an incompatible assessment type — rejected by
  `isAssessmentTypeCompatibleWithAsset` (implemented).
- **Still to design before a scanner is built:** following redirects or discovered
  endpoints outside a recorded scope; letting a target's own responses expand what's
  reachable next (the SSRF class of bug); host/path/port-level scope and exclusions
  finer than today's single per-asset boolean.
- Any code path that lets a scanner reach a target the _organization that owns the
  project_ has not authorized — the same tenant-isolation principle already enforced
  for projects/assets/assessments/api-keys (see [authorization.md](authorization.md))
  extends to whatever scope model lands: an asset authorized by Organization A must
  never be reachable by Organization B's assessments.

## Assessment lifecycle (implemented, Part H)

```
QUEUED ──► RUNNING ──► COMPLETED
  │           │
  │           └────► FAILED
  └────────────────► CANCELLED
```

`packages/shared-types`'s `canTransitionAssessmentStatus`/`canTransitionAssessmentJobStatus`
enforce this — terminal states never transition further. Only `QUEUED → CANCELLED` is
reachable via the API today (`POST /assessments/:id/cancel`); `RUNNING`/`COMPLETED`/
`FAILED` are reserved for the future worker that actually executes an assessment — the
API has no route that lets a client set an arbitrary status.

## Assessment → AssessmentJob → BullMQ pipeline (implemented, Part I)

`POST /projects/:projectId/assessments` creates the `assessments` row, an
`assessment_jobs` row, and enqueues a job on the existing `assessment-jobs` BullMQ
queue (`packages/queue`, unchanged since Batch 1) with the job row's id so a future
worker can correlate/resume/retry. **The worker that consumes it still only logs and
acknowledges** (Batch 1 behavior, untouched) — no scanner executes, no outbound
request is made. If enqueueing fails, both rows are marked `FAILED` rather than left
in a QUEUED-but-never-actually-queued state.

## Explicitly out of scope for this document

Not the scanner implementation itself, not SSRF-prevention mechanics (DNS pinning,
private-range blocking, timeout/resource limits), not the finding/evidence data
model, not host/path/port-level scope and exclusions. Those remain future batches;
this document is updated as each piece actually lands, not written once and left stale.
