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
`organization_members` has no concept of platform access. This split is the schema-level
enforcement of "platform administration is separate from tenant membership."

## The AuthPrincipal

Every authenticated request is normalized to one of two shapes
(`packages/auth/src/principals.ts`):

```ts
type AuthPrincipal =
  | { type: 'platform'; userId: string; role: PlatformRole }
  | {
      type: 'tenant';
      userId: string;
      organizationId: string;
      role: OrganizationRole;
      authType: 'user' | 'api-key';
    };
```

Route/service code depends on this union, never on a raw session or API-key row shape.
`hasPermission`/`requirePermission` only ever grant tenant permissions to a `'tenant'`
principal, and `hasPlatformPermission`/`requirePlatformPermission` only to a
`'platform'` principal — the two permission spaces cannot cross.

## Tenant isolation

**A UUID is never authorization.** Every organization-scoped query in `apps/api`'s
service layer filters by `principal.organizationId` — never by an id taken from the
request path/body alone. For a request targeting a specific resource by id (e.g.
`GET /projects/:projectId`), the service loads the row and then checks
`row.organizationId === principal.organizationId`; on mismatch it returns `null`,
which the route maps to **404**, not 403. This is deliberate: an org must not be able
to distinguish "doesn't exist" from "belongs to someone else" for a resource it
doesn't own (no existence leakage via status code).

`packages/auth` also exports `assertTenantAccess`/`requireTenantPermission`, which throw
`TenantAccessError` (403) instead. These are used where confirming existence is
intentional rather than a leak (e.g. a future admin action against a known org id) —
they are not used for the plain resource-by-id routes in this batch, on purpose.

This is enforced and tested end-to-end in `apps/api/src/api.integration.test.ts`
(Tenant A can never read/list/delete Tenant B's projects, api keys, or organization)
and at the query level in `packages/db/src/domain.integration.test.ts`.

## Roles and permissions

Permissions are plain strings (`packages/auth/src/permissions.ts`), e.g.
`project:create`, `billing:manage`, `api_key:revoke`. The mapping from role to
permission set is centralized in `packages/auth/src/role-permissions.ts`
(`ROLE_PERMISSIONS`, `PLATFORM_ROLE_PERMISSIONS`) — route/service code never branches
on `principal.role` directly; it always calls `hasPermission`/`requirePermission`.

| Tenant role        | Can do                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `OWNER`            | Everything, including `billing:manage`.                                                                            |
| `ADMIN`            | Organization/membership/project/API-key administration, `billing:read` — **not** `billing:manage`.                 |
| `SECURITY_MANAGER` | Assessment/finding read+write, project read/update — no membership or billing administration.                      |
| `DEVELOPER`        | Project read/create/update, assessment:read/create, finding:read — no membership, billing, or API-key permissions. |
| `VIEWER`           | Read-only across organization/member/project/assessment/finding.                                                   |

| Platform role | Can do                                                               |
| ------------- | -------------------------------------------------------------------- |
| `SUPER_ADMIN` | Every platform permission.                                           |
| `SUPPORT`     | Read-only: organizations, users, audit log. No billing, no mutation. |
| `BILLING`     | Organization read + billing read/manage. No user management.         |
| `OPERATIONS`  | System operate + audit read. No billing, no user management.         |

No platform role except `SUPER_ADMIN` has unrestricted access — see
`packages/auth/src/role-permissions.test.ts` for the enforced invariants.

## API keys

Flow (`packages/auth/src/api-key.ts`):

```
Authorization header
   → parseApiKeyHeader()          extract {keyPrefix, secret}, tolerant of "Bearer " prefix
   → findByPrefix(keyPrefix)      caller-supplied DB lookup (apps/api queries api_keys)
   → verify status != revoked, not expired
   → verifyApiKeySecret()         HMAC-SHA256(secret, key=CREDENTIAL_MASTER_KEY), constant-time compare
   → construct TenantPrincipal    authType: 'api-key'
```

- The raw secret is generated once (`generateApiKey`), returned to the caller in the
  `POST /api/v1/api-keys` response body, and **never persisted** — only `key_hash`
  (the HMAC) and `key_prefix` (a safe, non-secret lookup identifier) are stored.
- Hashing uses a keyed HMAC, not plain SHA-256: the secret is high-entropy random data
  (not a human password), so a slow KDF (bcrypt/argon2) would only add latency; the
  `CREDENTIAL_MASTER_KEY` keying means a leaked `key_hash` column alone cannot be
  brute-forced offline.
- Revocation sets `status = 'revoked'` (checked before the hash comparison even runs).
  Expiry is checked against `expires_at`; there is no separate stored "expired" status —
  it's derived at verification time.
- API keys belong to an **organization**, not a specific user (`api_keys` has no
  owning-user column). Because this batch has no per-key permission scopes yet, every
  API-key principal is granted a single fixed role, `API_KEY_DEFAULT_ROLE = 'ADMIN'`
  (everything except `billing:manage`) — broad enough to be useful for CI/automation
  (including managing the organization's own keys) while still excluding billing.
  Per-key scopes are deferred to a future batch.

## What this batch does _not_ implement (and why)

There is no real user login (password, OAuth, magic link, session) in this batch —
**API-key authentication is the only real authentication mechanism.** This has two
concrete, intentional consequences documented here rather than papered over:

- **`GET /api/v1/me`** returns whichever principal actually authenticated the request
  (currently always an API-key tenant principal) rather than a human user profile
  (name/email/avatar) — there is no session to back that with yet.
- **`POST /api/v1/organizations`** (creating a brand-new tenant) accepts any
  authenticated principal and does **not** create an initial `OWNER` membership,
  because API-key principals aren't tied to a real user and there's no logged-in human
  to assign as owner. A real signup flow wires this up once user authentication exists.

Both are explicit, tested behaviors — not stubs pretending to be complete.
