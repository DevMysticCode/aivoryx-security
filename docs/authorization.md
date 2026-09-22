# Authorization

## Platform identity vs. tenant identity

A user can have a **platform role** (operates Aivoryx Security itself) and separately
be a **member of zero or more organizations** (uses the product on behalf of a
customer). These are structurally independent:

```
users
├── platform_role   (nullable column on `users` — SUPER_ADMIN | SUPPORT | BILLING | OPERATIONS)
└── organization_members  (separate table: one row per org the user belongs to, with its own role)
```

There is no "platform organization" — a platform administrator is never a member of a
special tenant, and no seat/billing logic ever sees `platform_role`. Conversely,
`organization_members` has no concept of platform access.

## Two authentication mechanisms

| Mechanism      | Who                                                     | Carries                                                              | Lifecycle                                              |
| -------------- | ------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------ |
| Session cookie | A logged-in human (`POST /auth/register`/`/auth/login`) | `request.userId` — the real user id                                  | httpOnly cookie, 7-day fixed expiry, revoked on logout |
| API key        | A machine/CI credential (`POST /api-keys`)              | `request.principal` — a `TenantPrincipal` scoped to one organization | No expiry by default; revocable; optional `expires_at` |

Both are populated by a single `onRequest` hook (`apps/api/src/auth/context.ts`) —
**at most one applies per request** (an `Authorization` header takes precedence if
somehow both are present). `/health` and `/ready` read neither and stay open.

Every other route calls `requireAnyIdentity(request)` first (401 if neither
mechanism produced an identity), then resolves the specific organization it needs
access to via `resolveTenantPrincipalForOrganization`/
`requireTenantPrincipalForOrganization` (`apps/api/src/auth/context.ts`):

- If the request carries an API-key principal, it must match the target org exactly.
- If the request carries a session `userId`, the resolver looks up that user's
  `organization_members` row for the target org (must be `status: 'active'`) and
  builds a `TenantPrincipal` with the user's **real role in that org** — a session
  user's permissions are never fixed; they come from membership, so the same user
  can be `OWNER` in one org and have no access at all to another.

This is why routes with an id-in-URL org (e.g. `/organizations/:id/members`) and
routes deriving org from a nested resource (e.g. `/assets/:id`, whose org comes from
`asset -> project -> organization`) both work identically for session and API-key
callers, without the route code caring which mechanism authenticated the request.

## Human authentication (Part A)

- **Registration** (`POST /auth/register`): validates password strength (≥12 chars,
  at least one letter and one digit — `packages/auth/src/password.ts`), hashes with
  Argon2id (`@node-rs/argon2`, prebuilt binaries, OWASP-recommended parameters),
  rejects a duplicate email with 409, and returns a session cookie immediately (no
  separate email-verification step in this batch — there is no email-delivery
  infrastructure yet, so an account is active as soon as it's created).
- **Login** (`POST /auth/login`): verifies the password, checks `status === 'active'`,
  and — critically — **returns the identical generic `"Invalid email or password"`
  message and 401 status for both "no such account" and "wrong password"**, running a
  dummy Argon2 verification in the no-account case so the response time doesn't leak
  which branch was taken either. This is the user-enumeration mitigation; see the
  security review below.
- **Logout** (`POST /auth/logout`): sets `sessions.revoked_at`, clears the cookie.
  A revoked session's token hash still exists in the table (audit trail) but
  `verifySessionCredential` treats any `revoked_at` as an immediate failure.
- **Sessions**: an opaque, high-entropy random token (`packages/auth/src/session.ts`)
  — hashed with a keyed HMAC (`CREDENTIAL_MASTER_KEY`), never stored raw, same
  rationale as API keys (see below). Fixed 7-day expiry set at creation; no sliding
  renewal in this batch (a reasonable future improvement, not required now).
- **`GET /me`**: reflects whichever identity actually authenticated the request — a
  user profile for a session, or the raw `AuthPrincipal` for an API key. There is no
  fabricated "logged in as an API key user" profile.

### Cookie attributes and CSRF

The session cookie is `httpOnly`, `Secure` in production, `SameSite=Lax`, `Path=/`.
`SameSite=Lax` is the CSRF mitigation for this batch: it is sent on top-level
navigations but **not** on cross-site `fetch`/`XHR`/form-POST requests initiated by
another origin, which covers the realistic CSRF threat against a JSON API consumed by
this app's own frontend. A separate CSRF token was deliberately not added on top —
that would be meaningful defense-in-depth for a future browser-form-based flow, but
isn't required to close the CSRF gap for a cookie used only by same-origin `fetch`
calls, and adding it now would be complexity without a corresponding threat closed.

### Brute-force / rate limiting

`@fastify/rate-limit` is registered globally (300 req/min per IP) with stricter
per-route overrides: `POST /auth/register` (5/15min), `POST /auth/login` (10/15min),
`POST /organizations` (20/15min). This bounds credential-guessing and account-creation
abuse without needing a separate service.

## Organization bootstrap (Part B)

The Batch 2 gap — organization creation required an API key, but API keys require an
existing organization — is fixed:

```
1. POST /auth/register           -> session cookie
2. POST /organizations            -> org created; caller's session userId is
                                      automatically added as OWNER (no separate step)
3. POST /api-keys {organizationId} -> raw key returned once, from the session
4. Authorization: Bearer <key>     -> programmatic access from here on
```

`organizationsService.create` (`apps/api/src/services/organizations.ts`) only
creates the OWNER membership when a real `userId` is present (session auth). An
API-key-authenticated `POST /organizations` still works (any authenticated identity
may create a new org — there's no tenant permission for "create an organization",
since permissions apply _within_ an org that already exists) but creates no
membership, because an API key isn't tied to a real user row — there's no one to
make OWNER. This is an intentional, narrow limitation, not an oversight.

## Tenant isolation

**A UUID is never authorization.** Every organization-scoped query filters by a
resolved principal's `organizationId` — never by an id taken from the request alone.
For a resource fetched by id (project/asset/assessment/api-key), the service loads
the row, resolves tenant access against _its_ organization, and returns `null` on any
mismatch — the route maps `null` to **404**, not 403, so "doesn't exist" and
"belongs to someone else" are indistinguishable to an unauthorized caller.

For routes where the organization id is client-asserted directly in the URL
(`/organizations/:id/...`), a 403 (`TenantAccessError`) is used instead — the client
already named that org, so confirming they can't access it leaks nothing new.

Enforced and tested end-to-end in `apps/api/src/api.integration.test.ts` for
projects, assets, assessments, members, and organizations, and at the query level in
`packages/db/src/domain.integration.test.ts`.

## Roles and permissions

Permissions are plain strings (`packages/auth/src/permissions.ts`); the mapping from
role to permission set is centralized in `packages/auth/src/role-permissions.ts` —
route/service code never branches on `principal.role` directly, only on
`hasPermission`/`requirePermission`.

| Tenant role        | Notable grants                                                                                                                                                                                 |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OWNER`            | Everything, including `billing:manage` and `asset:delete`.                                                                                                                                     |
| `ADMIN`            | Same as OWNER except `billing:manage` (read-only billing).                                                                                                                                     |
| `SECURITY_MANAGER` | Full asset lifecycle including `asset:update` (confirms authorization) and `asset:create`, plus all assessment/finding permissions — **not** `asset:delete`, membership, or billing.           |
| `DEVELOPER`        | `project:*` (except delete), `asset:read`/`asset:create` — **not** `asset:update` (cannot confirm authorization — separation of duties, see below), no membership/billing/API-key permissions. |
| `VIEWER`           | Read-only everywhere.                                                                                                                                                                          |

### Separation of duties on authorization confirmation

`asset:update` is the permission gating `authorizationConfirmed` (see
[security-model.md](security-model.md)) as well as ordinary edits. DEVELOPER
deliberately lacks it: a developer can _add_ an asset for testing, but confirming
that the organization is actually authorized to have it assessed is a
SECURITY_MANAGER/ADMIN/OWNER decision. This is enforced (not just documented) — see
`packages/auth/src/role-permissions.test.ts` and the integration test "a DEVELOPER
can create an asset but cannot confirm its authorization".

### Membership safety: an organization can never become ownerless

`membersService.updateRole`/`.remove` (`apps/api/src/services/members.ts`) both
refuse the operation (400) if it would drop the organization's active-OWNER count to
zero. This isn't explicitly required by role/permission checks alone — it's a
business-rule guard layered on top, because OWNER is the only role that can restore
another OWNER, so losing the last one would permanently lock the organization out of
billing/ownership administration.

## Membership / invitations (Part C)

`POST /organizations/:id/members` requires the target email to already belong to a
**registered** user — it adds them directly with `status: 'active'`. There is no
email-delivery infrastructure in this batch, so the full flow (invite an
unregistered email, they receive a link, they complete signup, membership activates)
is deferred; the `membership_status` enum's `'invited'` value remains in the schema
for that future flow, and the service/route layering (`add`/`updateRole`/`remove`
each independently authorized and audited) needs no redesign to add it — only a new
"pending invitation" record type and an email sender.

## API keys

Unchanged from Batch 2 (`packages/auth/src/api-key.ts`): keyed-HMAC hash (not a slow
KDF — the secret is high-entropy random data, not a human password), raw secret
returned exactly once at creation, revocation checked before hash comparison,
`API_KEY_DEFAULT_ROLE = 'ADMIN'` (every key gets the same fixed role — no per-key
scopes yet). Now reachable from a session (Part B's bootstrap flow) in addition to
the original machine-only path.

## Which endpoints accept which auth mechanism (Part K)

| Endpoint                                       | Session                          | API key      |
| ---------------------------------------------- | -------------------------------- | ------------ |
| `GET /health`, `GET /ready`                    | n/a (public)                     | n/a (public) |
| `POST /auth/register`, `/login`, `/logout`     | n/a (these _create_ the session) | n/a          |
| `GET /me`                                      | ✅                               | ✅           |
| `GET`/`POST /organizations`                    | ✅                               | ✅           |
| `GET /organizations/:id`, `/members*`          | ✅                               | ✅           |
| `GET`/`POST`/`PATCH`/`DELETE /projects*`       | ✅                               | ✅           |
| `GET`/`POST`/`PATCH /assets*`                  | ✅                               | ✅           |
| `GET`/`POST /assessments*`, `/cancel`          | ✅                               | ✅           |
| `GET`/`POST /api-keys`, `DELETE /api-keys/:id` | ✅                               | ✅           |

Every organization-scoped route accepts both mechanisms uniformly (Part K: "do not
remove or weaken API-key authentication") — the dual-resolution design above is what
makes that possible without duplicating route logic per auth type.
