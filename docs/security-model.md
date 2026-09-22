# Security model for assessments

Batch 4 adds the first real scanner and the outbound-request pipeline: an
explicit technical scope, SSRF protection, a DNS-rebinding-resistant safe
HTTP client, and one non-invasive HTTP reachability scanner. Batch 3
implemented the _authorization and domain-model_ half of this document
(Asset, Authorization confirmation, Assessment, compatibility validation).
No vulnerability-detection, crawling, fuzzing, or exploitation logic exists —
see "Explicitly out of scope" below.

## The model

```
Project
  ↓
Asset                 what could be assessed (WEB | API | ANDROID | IOS)              ✅ implemented (Batch 3)
  ↓
Authorization          explicit, recorded confirmation the org is allowed to test it   ✅ implemented (Batch 3)
  ↓
Scope / Exclusions      exactly what is in-bounds vs. explicitly out-of-bounds         ✅ implemented (Batch 4, WEB/API asset types only)
  ↓
Assessment               a scheduled/queued run against an authorized asset            ✅ implemented (Batch 3/4, full lifecycle)
  ↓
Scanner                  the thing that actually makes requests                        ✅ one scanner implemented (Batch 4): http-reachability
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
  override scope** — implemented in Batch 4. `assessments.scope`
  (`packages/shared-types/src/scope.ts`'s `AssessmentScope`) is computed from the
  asset's config and snapshotted onto the assessment **at creation time**, immutable
  afterward even if the asset's config later changes. `authorizationConfirmed` means
  "the organization may have this asset assessed at all"; `AssessmentScope` is the
  separate, finer-grained boundary that actually constrains outbound requests — a
  scanner checks scope on every request, never `authorizationConfirmed` directly. For
  WEB/API assets, scope is derived from the asset's `baseUrl`/`additionalHosts`
  (`buildWebAssetScope`); ANDROID/IOS assets get an empty scope today since no
  scanner targets them yet.
- **An assessment is scoped to one asset at creation time** (`assessments.asset_id`,
  immutable) — not "whatever the project currently contains."
- **The scanner is the last, most restricted link in the chain** — implemented in
  Batch 4: `packages/scanner-core`'s `SafeHttpClient` is the only way a scanner
  plugin may make an outbound request; plugins have no other network access.

## What this guarantees will never happen

A scanner must never be able to attack an arbitrary internet target just because a
user (or a compromised API key) supplied a URL somewhere. Concretely, this rules out:

- Treating "an asset row exists" as sufficient to assess it — `authorizationConfirmed`
  must be `true`, checked server-side (implemented) and re-checked defensively by the
  worker before it starts (Batch 4, in case authorization is revoked between
  enqueue and execution).
- Treating "the user who added the asset" as automatically authorized to confirm it —
  separation of duties via `asset:update` (implemented).
- Assessing an asset type with an incompatible assessment type — rejected by
  `isAssessmentTypeCompatibleWithAsset` (implemented).
- Following a redirect or discovered endpoint outside the assessment's recorded
  scope — `SafeHttpClient` re-runs full scope + SSRF validation on **every** redirect
  hop, never just the initial URL (implemented, Batch 4; see "SSRF and scope
  enforcement" below).
- A target's own DNS answers expanding what's reachable (the SSRF/DNS-rebinding
  class of bug) — the client resolves a hostname once, validates every returned
  address, and pins the actual connection to the address it validated, so a second,
  different DNS answer at connect time is never trusted (implemented, Batch 4; see
  `packages/scanner-core/src/dns-safe-resolve.ts`).
- Any code path that lets a scanner reach a target the _organization that owns the
  project_ has not authorized — the same tenant-isolation principle already enforced
  for projects/assets/assessments/api-keys (see [authorization.md](authorization.md))
  extends to scope: an asset authorized by Organization A can never be reachable by
  Organization B's assessments, since scope is derived from the specific asset row a
  tenant-isolated query already resolved.

## SSRF and scope enforcement (Batch 4, Parts B/C/D/E/F/G)

`packages/scanner-core`'s `SafeHttpClient` is the only supported way for a scanner
to make an outbound request (`packages/scanners/http-reachability` — the only
scanner that exists — uses nothing else). Before any request, and again on every
redirect hop:

1. Scheme validated (`http`/`https` only).
2. Host/port/path validated against the assessment's `AssessmentScope`
   (`packages/scanner-core/src/scope.ts`) — exclusions win over the allow-list.
3. The hostname is resolved via DNS once; **every** returned address is checked
   against the SSRF policy (`packages/scanner-core/src/ssrf.ts`) — blocking RFC1918/
   loopback/link-local/multicast/reserved IPv4 and IPv6 ranges, cloud metadata
   (`169.254.169.254`, covered by the link-local block), and IPv4-mapped/NAT64 IPv6
   addresses that embed a blocked IPv4. If any resolved address is blocked, the whole
   hostname is rejected — a host with one public and one private A record is treated
   as unsafe, not "lucky."
4. The connection is opened to the exact validated address (a custom DNS `lookup`
   override on the underlying `http`/`https` request), not re-resolved by the
   networking stack — this is what prevents a second, different DNS answer between
   validation and connection (DNS rebinding).
5. A redirect response is never followed blindly: its `Location` is parsed, its
   scheme checked, and the whole 1-4 pipeline reruns against it — a redirect from an
   authorized host to `127.0.0.1` or to an out-of-scope public host is rejected, not
   followed.
6. Resource limits apply throughout: connect timeout, overall request timeout,
   maximum redirect count, a maximum response byte count enforced against the raw
   (never decompressed) wire size — this client does not decompress responses at all,
   which sidesteps decompression-bomb risk entirely rather than trying to bound a
   post-decompression size — and an approximate header-size cap.

**Test-only exception:** `SSRF_ALLOW_PRIVATE_RANGES` (`packages/config`) lets
integration tests point the client at a local test fixture; the config schema
refuses to let it be `true` when `NODE_ENV=production`, so this can never weaken
production behavior.

A scope or SSRF rejection is a **permanent** failure — the assessment/job are marked
`FAILED` and the worker does not rethrow, so BullMQ never retries a policy violation
into a loop. An ordinary connection failure (DNS not resolving, connection refused,
timeout) is different: it is recorded as an `INFO`-severity "target unreachable"
finding, not a failure, since a target being down isn't a security violation.

## Assessment lifecycle (implemented, Part H)

```
QUEUED ──► RUNNING ──► COMPLETED
  │           │
  │           └────► FAILED
  └────────────────► CANCELLED
```

`packages/shared-types`'s `canTransitionAssessmentStatus`/`canTransitionAssessmentJobStatus`
enforce this — terminal states never transition further. `QUEUED → CANCELLED` is
reachable via the API (`POST /assessments/:id/cancel`); `QUEUED → RUNNING → COMPLETED/
FAILED` is driven entirely by `apps/worker` (Batch 4) — the API has no route that lets
a client set an arbitrary status. Every transition the worker makes is a conditional
`UPDATE ... WHERE status = <expected current status>`, so a stale or duplicate worker
attempt can never overwrite a newer state (see "Assessment execution" below).

## Assessment → AssessmentJob → BullMQ → worker pipeline (implemented, Parts I/P/Q/R)

`POST /projects/:projectId/assessments` creates the `assessments` row (including its
scope snapshot), an `assessment_jobs` row, and enqueues a job on the `assessment-jobs`
BullMQ queue (`packages/queue`) with `attempts: 3` and exponential backoff — bounding
_automatic_ retries to genuine transient infrastructure failures (Part R). If
enqueueing itself fails, both rows are marked `FAILED` immediately rather than left
QUEUED-but-never-actually-queued.

`apps/worker/src/assessment-processor.ts` consumes the job. It trusts nothing from
the job payload except the two ids — it loads the assessment/asset/job rows fresh
from the database (never the queue payload) and:

1. Skips (does not re-run) an assessment that isn't `QUEUED` — a duplicate delivery,
   a stale retry, or one the API already cancelled.
2. Re-checks `authorizationConfirmed` defensively (it could have been revoked between
   enqueue and pickup) and fails permanently if it's false.
3. Claims the job with a conditional `QUEUED → RUNNING` update; if that update
   affects zero rows, another attempt already claimed it and this one backs off.
4. Selects scanner plugins from its local registry
   (`packages/scanner-core`'s `selectApplicablePlugins`) by asset type + assessment
   type + this worker's declared capabilities (`['http-egress']` today — Part K) —
   never by trusting a scanner name from the job payload.
5. If no scanner applies yet (every non-WEB combination today —
   `ANDROID_STATIC`/`ANDROID_DYNAMIC`/`IOS_STATIC`/`IOS_DYNAMIC`), the assessment
   **fails** with `UnsupportedAssessmentTypeError` — `COMPLETED` must mean an
   assessment actually ran, so "not implemented yet" is never silently treated as
   success with zero findings.
6. Runs each applicable plugin against a `SafeHttpClient` built from
   `@aivoryx/config`'s security settings, persisting findings/evidence as the plugin
   reports them (deduplicated by fingerprint — see below), then marks the assessment
   `COMPLETED`.
7. On an unexpected error, classifies it: a `ScopeViolationError`/`SsrfViolationError`/
   `ResourceLimitExceededError`/`UnsupportedAssessmentTypeError` is a **permanent**
   failure (marked `FAILED` with a structured, stable `[CODE] message` reason — e.g.
   `[UNSUPPORTED_ASSESSMENT_TYPE] ...` — not rethrown, never retried); anything else
   is rethrown so BullMQ's own attempts/backoff can retry a genuine transient
   failure.

**Known limitation:** cancelling a `RUNNING` assessment mid-flight isn't implemented —
`POST /assessments/:id/cancel` only works while an assessment is still `QUEUED`. A
`ScannerContext.signal` exists for future use but nothing currently triggers it.

## Findings and evidence (implemented, Parts M/N/O)

`findings` (severity `INFO`/`LOW`/`MEDIUM`/`HIGH`/`CRITICAL`, confidence, category,
status, target) and `evidence` (structured, sanitized request/response metadata) are
written only by the worker — never by the API, which only reads them back via
`GET /assessments/:id/findings` (gated on the existing `finding:read` permission).
Every finding has a deterministic fingerprint
(`packages/scanner-core/src/fingerprint.ts`: assessment + scanner + category +
normalized target + a scanner-chosen key) enforced unique per assessment at the
database level (`findings_assessment_fingerprint_unique`) — a retried job re-running
the same scanner never creates a duplicate row, it just no-ops on conflict. Evidence
is redacted (secret-shaped field names) and size-capped before insert; the
reachability scanner's evidence never includes `Set-Cookie`, `Authorization`, or a
full response body — see `packages/scanners/http-reachability`.

## The first scanner: HTTP reachability (implemented, Part L)

`packages/scanners/http-reachability` — the only scanner package that exists —
applies only to `WEB` assets under a `WEB` assessment. It issues exactly one `GET`
request (via `SafeHttpClient`, never a raw HTTP client) to the asset's `baseUrl` and
records a single `INFO`-severity finding: reachable (with status/headers/timing/
redirect chain) or unreachable. It never submits forms, mutates state, brute-forces
paths, crawls discovered links, fuzzes, or executes JavaScript — see the hard scope
boundary at the top of this document.

## Explicitly out of scope for this document

Vulnerability detection/exploitation of any kind (SQLi, XSS, SSRF exploitation,
auth bypass, brute force, fuzzing), crawling, browser automation/JS execution, API
fuzzing/OpenAPI-driven testing, mobile scanning, and report generation. Those remain
future batches; this document is updated as each piece actually lands, not written
once and left stale.
