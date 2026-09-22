# @aivoryx/auth

Authentication/authorization primitives only — no database access, no HTTP, no
scanner/business logic. See [docs/authorization.md](../../docs/authorization.md) for
the full design (platform vs. tenant identity, roles/permissions, API-key flow,
tenant isolation).

## Contents

- `principals.ts` — the `AuthPrincipal` discriminated union (`platform` | `tenant`)
- `roles.ts` / `permissions.ts` / `role-permissions.ts` — the centralized role→permission table
- `authorization.ts` — `hasPermission`, `requirePermission`, `assertTenantAccess`,
  `requireTenant`, `requireTenantPermission`
- `api-key.ts` — API-key generation, keyed-HMAC hashing/verification, header parsing
- `errors.ts` — `AuthenticationError` (401), `AuthorizationError` (403),
  `TenantAccessError` (403, tenant-isolation specific)

## Usage

```typescript
import { requirePermission, requireTenant, type AuthPrincipal } from '@aivoryx/auth';

function handleCreateProject(principal: AuthPrincipal) {
  const tenant = requireTenant(principal); // throws AuthorizationError for a platform principal
  requirePermission(tenant, 'project:create'); // throws AuthorizationError if denied
  // ... proceed, scoped to tenant.organizationId
}
```

## Tests

```bash
pnpm --filter @aivoryx/auth test
```

No external services required — this package has no database or network dependency.
