# Security model for assessments

Batch 4 added the first real scanner and the outbound-request pipeline: an
explicit technical scope, SSRF protection, a DNS-rebinding-resistant safe
HTTP client, and one non-invasive HTTP reachability scanner. Batch 5 turned
that single controlled HTTP observation into a **passive web security
analysis engine** — deterministic, evidence-backed findings (security
headers, cookie security, CORS, information disclosure, transport, HTTP
behavior) derived from the same request, never from additional target
traffic. Batch 6 adds **scope-aware discovery**: the reachability request's
response is now also parsed for links/resources/forms, and in-scope pages
are crawled (bounded BFS, conservative defaults) so passive analysis runs
across the discovered attack surface, not just the seed URL — still through
the exact same `SafeHttpClient`, still zero additional risk surface. Batch 3
implemented the _authorization and domain-model_ half of this document
(Asset, Authorization confirmation, Assessment, compatibility validation).
No vulnerability-detection, exploitation, form submission, JavaScript
execution, or active testing of any kind exists — see "Explicitly out of
scope" below.

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

## The first scanner: HTTP reachability + passive analysis (implemented, Batch 4/5)

`packages/scanners/http-reachability` — the only scanner package that exists —
applies only to `WEB` assets under a `WEB` assessment. It issues exactly one `GET`
request (via `SafeHttpClient`, never a raw HTTP client) to the asset's `baseUrl`,
records a single `INFO`-severity reachability finding (Batch 4, unchanged), and then
(Batch 5) builds an `HttpObservation` from that **same response** and runs every
passive check against it — no second request. It never submits forms, mutates state,
brute-forces paths, crawls discovered links, fuzzes, or executes JavaScript — see the
hard scope boundary at the top of this document.

## Passive analysis architecture (implemented, Batch 5 Parts A/B/Q/R/S)

```
HTTP Reachability (one GET, via SafeHttpClient)
      ↓
HttpObservation           packages/scanner-core/src/http-observation.ts
      ↓
WEB_PASSIVE_CHECKS        packages/scanners/web-passive — a PassiveCheck<HttpObservation>[]
      ├── security-headers   CSP / HSTS / X-Content-Type-Options / Referrer-Policy /
      │                      Permissions-Policy / framing (X-Frame-Options or CSP frame-ancestors)
      ├── cookie-security     Secure / HttpOnly / SameSite, from sanitized Set-Cookie metadata
      ├── cors                 wildcard origin, wildcard+credentials
      ├── information-disclosure   Server / X-Powered-By / framework-version headers
      ├── transport             HTTP target, HTTPS→HTTP downgrade
      └── http-behavior          5xx responses, missing Content-Type
      ↓
ReportFindingInput[]  (pure, synchronous — see below)
      ↓
apps/worker persists findings + evidence (deduplicated by fingerprint)
```

- **`HttpObservation`** (`packages/scanner-core/src/http-observation.ts`) is the typed
  model every check operates on: status, headers (excluding `set-cookie`, which
  becomes sanitized `HttpCookieObservation[]` — name + flags only, value discarded
  immediately after parsing), content type, redirect chain, and TLS protocol when
  available. It is built once, from the reachability scanner's one response.
- **`PassiveCheck<TObservation>`** (`packages/scanner-core/src/passive-check.ts`) is
  `{ name, category, run(observation, context) }` — deliberately synchronous and pure.
  A check has no `httpClient`, no network access at all; the only way to add a target
  request is to write a new `ScannerPlugin`, not a passive check. `runPassiveChecks()`
  runs every check in a registry against the same observation and concatenates their
  findings; `createPassiveCheckRegistry()` rejects duplicate check names at
  registration time (Part R) — there is no route for an API client to select or
  supply a check implementation.
- **WEB_PASSIVE** (`packages/scanners/web-passive`'s `WEB_PASSIVE_CHECKS`) is the
  built-in profile for this batch: security-headers, cookie-security, cors,
  information-disclosure, transport, http-behavior — six checks, one category each.
- **Request budget**: proven by test, not just by design — both
  `packages/scanners/http-reachability/src/index.test.ts` and
  `apps/worker/src/assessment-processor.integration.test.ts`'s end-to-end test count
  actual requests reaching the fixture server and assert the count is exactly 1 for
  the whole assessment, reachability finding plus all six passive checks included.

## Finding quality and false-positive control (Batch 5 Parts C/K/L/M/V)

Every check follows the same discipline: only report a finding when the HTTP
evidence directly proves the condition, and default to `INFO` or no finding at all
when the evidence doesn't support a stronger claim. Concretely:

- A **missing** recommended header (CSP, Referrer-Policy, X-Content-Type-Options) is
  `LOW` severity, `HIGH` confidence — the absence itself is 100% certain, but the
  practical impact is a judgment call, kept conservative. A missing
  Permissions-Policy is `INFO` only — explicitly not treated as a vulnerability.
- **HSTS is never evaluated on an HTTP response** — Strict-Transport-Security is
  meaningless without TLS in the first place (`security-headers.ts`'s `checkHsts`).
- **Framing protection** checks X-Frame-Options **or** CSP `frame-ancestors` and
  reports at most one finding — never two findings for the same underlying gap, and
  never a false "missing X-Frame-Options" when `frame-ancestors` already protects the
  page (tested explicitly in `security-headers.test.ts`).
- **Cookies are not assumed sensitive.** A name-pattern heuristic
  (`session|auth|token|jwt|sid|login|remember`) only affects severity (`MEDIUM` vs
  `LOW`) for a flag gap, never whether a finding fires at all. The Secure-flag check
  is skipped entirely on an HTTP response (Secure would break the cookie, not protect
  it, on a site that isn't HTTPS). `SameSite=None` without `Secure` is flagged at
  `MEDIUM`/`HIGH` confidence because that combination is rejected outright by modern
  browsers — a deterministic misconfiguration, not a judgment call.
- **CORS** only fires on `Access-Control-Allow-Origin: *`, and only escalates to
  `MEDIUM` when combined with `Access-Control-Allow-Credentials: true` (an invalid,
  directly-observed combination) — confidence is `MEDIUM` there because passive
  analysis alone can't prove a browser would honor it. A specific origin, even
  combined with credentials, produces **no finding** — Part F is explicit that
  passive analysis must never claim behavior it never sent a differentiating
  `Origin` header to observe.
- **Information disclosure** (`Server`, `X-Powered-By`, framework-version headers) is
  always `INFO` — disclosure alone is never scored as a vulnerability, and a finding
  is only ever created for a header that is literally present in the response (never
  invented).
- **HTTP-only targets** are `LOW`, not `HIGH`/`CRITICAL`; an HTTPS→HTTP downgrade
  redirect is `MEDIUM` because it is a real, directly-observed regression in an
  existing protection, not a bare absence.

## Evidence and remediation (Batch 5 Parts M/N/P; schema in Part W)

`findings` gained three columns this batch: `key` (the check's stable identifier for
this specific observation, e.g. `cookie:session:missing-secure` — distinct from the
opaque `fingerprint` hash, useful for filtering/debugging), `remediation` (static,
deterministic guidance — never AI-generated), and `references` (a small `jsonb`
array of genuinely relevant URLs, omitted when there's nothing worth linking).
Evidence keeps the same size-capping and secret-key-pattern redaction from Batch 4
(`apps/worker/src/assessment-processor.ts`'s `sanitizeEvidence`); cookie evidence is
deliberately keyed `name` rather than `cookie` specifically because that redaction
pattern treats any key _containing_ "cookie" as secret-shaped — the safer, more
precise choice over trying to special-case the pattern.

## Scope-aware web discovery (implemented, Batch 6)

`packages/scanners/web-discovery` turns the single reachability fetch into a bounded
breadth-first crawl of the authorized application. Its `webDiscoveryScanner`
**supersedes** Batch 4's `httpReachabilityScanner` in the worker's active registry
(`apps/worker/src/index.ts`) for WEB/WEB assessments — only one scanner runs, so the
seed is still fetched exactly once, never twice. `packages/scanners/http-reachability`
itself is untouched and remains independently buildable/testable.

- **URL normalization** (`url-normalize.ts`): lowercases the hostname, strips the
  scheme's default port, removes the fragment, and normalizes an empty path to `/`.
  Dot-segments are collapsed by WHATWG URL resolution. The query string is **never**
  touched — `/product?id=1` and `/product?id=2` are always distinct discovered URLs,
  since a query string can encode an entirely different application route. A real
  trailing slash (`/foo/`) is left alone; only the no-path-at-all case is normalized,
  since collapsing `/foo/` to `/foo` could change which resource a server returns.
- **Scope remains authoritative, not same-origin.** Every discovered URL is
  normalized, then checked against the assessment's `AssessmentScope` (the same
  `checkUrlAgainstScope` Batch 4 built) **before** it is ever added to the crawl
  queue — an out-of-scope URL is recorded as a `URL_SKIPPED_OUT_OF_SCOPE` event and
  never requested. The one deliberate exception: the **seed** URL is queued directly,
  bypassing that pre-filter, specifically so that an out-of-scope seed reaches
  `SafeHttpClient`'s own validation and throws a loud `ScopeViolationError` (a
  permanent worker failure) rather than the crawler silently doing nothing and the
  assessment completing with zero findings.
- **Redirects** are still handled entirely by `SafeHttpClient` — the crawler
  implements no redirect logic of its own. When a fetch's `finalUrl` differs from
  what was linked (a redirect happened), the crawler additionally records the final
  destination as its own discovery (`discoveryMethod: 'REDIRECT'`), so the persisted
  attack surface reflects what was actually reached.
- **HTML parsing** uses `htmlparser2` (a tolerant SAX-style parser, not a browser) —
  malformed markup is parsed best-effort, never thrown on. **No JavaScript is ever
  executed and no browser is ever launched** — `<script src>` is recorded as a
  resource reference only; the referenced file is never fetched, parsed, or
  executed. JavaScript-generated routes/links are consequently invisible to this
  crawler — a known limitation, not an oversight.
- **Resources vs. pages.** `<a>`/`<area>`/`<link>`/`<iframe>`/`<frame>` are
  navigational — in-scope targets are queued for a further fetch (`depth + 1`).
  `<script>`/`<img>`/`<source>`/`<video>`/`<audio>`/`<object>` are recorded as
  discovered resources **without ever being fetched** — no request budget is spent
  confirming a `.js`/image/etc. actually exists; only navigable pages consume a
  crawl request.
- **Forms are metadata-only, never submitted.** `extractFromHtml` records a form's
  action/method/input-names-and-types while parsing; `SafeHttpMethod` is typed as
  `'GET' | 'HEAD'` only, so the crawler is structurally incapable of issuing a
  POST/PUT/PATCH/DELETE request even if it tried.
- **robots.txt/sitemap.xml** (`robots.ts`/`sitemap.ts`) are off by default
  (`CrawlLimits.robotsEnabled`/`sitemapEnabled`) since they're explicitly optional
  and each adds a request; when enabled, a `Sitemap:` directive or `/sitemap.xml` is
  fetched through `SafeHttpClient` like any other URL, and **every URL it names is
  still scope-checked before being queued** — robots.txt is parsed only for
  `Sitemap:` lines (Disallow/Allow are never enforced; robots.txt is explicitly not a
  security boundary and can never expand what the assessment's scope allows).
  Sitemap `<loc>` extraction is capped at `maxSitemapUrls` and never follows a
  sitemap-of-sitemaps.
- **Explicit, centrally-enforced limits** (`CrawlLimits`, conservative defaults):
  `maxDepth: 2`, `maxUrls: 50`, `maxTotalRequests: 60`, `maxConcurrentRequests: 3`,
  `requestsPerSecond: 5`, `maxSitemapUrls: 100`, `maxLinksPerPage: 50`. Concurrency
  and rate limiting are enforced by one shared `RequestScheduler` (`rate-limiter.ts`)
  across the whole crawl, not per-URL. Hitting a limit stops scheduling further work
  in that category and is recorded (`limitsHit`); it never silently keeps going.
- **No authenticated crawling.** The crawler carries no session/cookie jar and never
  replays a `Set-Cookie` it observes back to the target — every request is anonymous,
  exactly like the underlying `SafeHttpClient`.
- **Persistence** (`discovered_urls` table, Batch 6 migration): normalized URL,
  source URL, type, discovery method, depth, status/content-type/response size where
  fetched, and type-specific metadata (form input names/types only). Deduplicated at
  the database level on `(assessment_id, url, url_type)` — the same URL can
  legitimately appear once as a `PAGE` and, separately, as a `FORM_ACTION`, but never
  twice in the same role. Sensitive-looking query parameter **values** (token,
  password, api_key, secret, auth, session, credential) are redacted before a URL is
  ever persisted (`redactSensitiveQueryParams`) — the real, unredacted URL is what's
  actually used to make the request; only the stored copy is redacted. No cookie
  values, Authorization headers, or response bodies are ever persisted.
- **Findings continue to come from the same fetch.** Every fetched HTML page (not
  just the seed) is passed through `buildHttpObservation`/`runPassiveChecks` exactly
  once — the crawler never re-fetches a page to run passive analysis separately from
  discovery parsing. Proven by request-count assertions in both
  `packages/scanners/web-discovery/src/crawler.test.ts` and
  `apps/worker/src/assessment-processor.integration.test.ts`.

## Explicitly out of scope for this document

Vulnerability detection/exploitation of any kind (SQLi, XSS, SSRF exploitation,
auth bypass, brute force, fuzzing, parameter discovery, form submission or any
mutating request), authenticated/session-aware crawling, JavaScript execution or
browser automation of any kind, API fuzzing/OpenAPI-driven testing, active CORS
testing (sending an attacker-controlled `Origin` header), mobile scanning,
AI/LLM-generated analysis of any kind, and report generation. Those remain future
batches; this document is updated as each piece actually lands, not written once and
left stale.
