# Security model for future assessments

**No scanner, crawler, or assessment-execution logic exists yet.** This document
describes the authorization/scope model that will govern that functionality once it
is built, so it's designed in before any code that could act on it exists.

## The model

```
Project
  ↓
Targets              what could be scanned (a URL, a host, an API spec, a mobile build)
  ↓
Authorization         explicit, recorded proof the organization is allowed to test it
  ↓
Scope                 exactly what is in-bounds (hosts, paths, ports)
  ↓
Exclusions             what is explicitly out-of-bounds even if in scope
  ↓
Assessment              a scheduled/executed run against an authorized, scoped target
  ↓
Scanner                 the thing that actually makes requests
```

Each stage is a hard gate on the one below it, not a formality:

- **A target existing is not authorization to scan it.** Adding a target to a project
  records _what it is_; it grants no scanning rights by itself.
- **Authorization must be explicit and recorded**, not inferred from "the user typed a
  URL into a form." A future `targets`/`target_authorizations`-shaped table records who
  authorized a target, when, and (eventually) how that was verified — mirroring how
  `organization_members`/`api_keys` in this batch already require an explicit row to
  exist before access is granted; there is no implicit trust anywhere in this codebase,
  and there won't be for scan targets either.
- **Scope is a positive allow-list** (specific hosts/paths/ports), not "anything under
  this domain." A scanner must refuse to act outside the recorded scope even if a
  discovered link or redirect points elsewhere.
- **Exclusions override scope.** An organization must be able to carve out paths/hosts
  that are in-scope generally but must never be touched (e.g. a fragile legacy
  subsystem, a third-party-owned subdomain that happens to resolve under the same
  parent domain).
- **An assessment is scoped to one authorized target set at execution time** — not to
  "whatever the project currently contains," so scope changes after an assessment
  starts don't silently widen what's being tested mid-run.
- **The scanner is the last, most restricted link in the chain.** It receives an
  already-authorized, already-scoped assessment and must have no independent path to
  reach anything else — see the worker/network isolation boundary below.

## What this guarantees will never happen

A future scanner must never be able to attack an arbitrary internet target just
because a user (or a compromised API key) supplied a URL somewhere. Concretely, this
rules out:

- Treating "a project has a target row" as sufficient to scan it.
- Treating "the user who added the target" as automatically authorized, without an
  explicit authorization step recorded.
- Following redirects or discovered links outside the recorded scope.
- Letting a scan target's own responses expand what the scanner is allowed to touch
  next (e.g. a redirect to an internal/private address — this is the SSRF class of
  bug the eventual scanner worker must defend against, on top of scope/authorization).
- Any code path that lets a scanner reach a target the _organization that owns the
  project_ has not explicitly authorized — the same tenant-isolation principle
  enforced today for projects/api-keys/organizations (see
  [authorization.md](authorization.md)) extends to targets and assessments once they
  exist: a target authorized by Organization A is never reachable by Organization B's
  assessments, and an assessment can never execute outside its own recorded scope.

## Relationship to today's tenant isolation

This is the same trust boundary Batch 2 already enforces for projects, API keys, and
organizations (never accessible by id alone; always checked against
`principal.organizationId`) — the assessment authorization/scope model is that same
principle applied one layer deeper, to the specific hosts/paths a project's targets
are allowed to touch. Building the scanner without this model already decided would
risk shipping the SSRF/arbitrary-target-attack exposure the rest of this document
exists to prevent; that's why it's written down now, before the code.

## Explicitly out of scope for this document

This document describes the _authorization and scope model_ — not the scanner
implementation, not SSRF-prevention mechanics (DNS pinning, private-range blocking,
timeout/resource limits), not the finding/evidence data model. Those are covered by
the earlier architecture proposal's security-boundaries section and will be
elaborated when the scanner is actually built.
