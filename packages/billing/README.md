# @aivoryx/billing

Provider-agnostic billing domain: plan catalog, seat-usage math, and the
`BillingProvider` interface a future payment-provider adapter (e.g. Stripe)
implements. See [docs/billing.md](../../docs/billing.md) for the full design.

**No live billing-provider integration exists in this package.** No SDK is installed,
no network calls are made, no webhooks are handled — `provider.ts` is a contract only.

## Contents

- `types.ts` — `PlanDefinition`, `SubscriptionRecord`, `PaymentRecord`, and the
  provider-neutral status/interval unions
- `plans.ts` — `PLAN_CATALOG` (reference plan definitions) and `getPlanDefinition(code)`
- `subscription.ts` — `computeSeatUsage`, `canAddMember`, `assertSeatAvailable`
  (throws `SeatLimitExceededError`)
- `provider.ts` — the `BillingProvider` interface a future adapter implements

## Usage

```typescript
import { assertSeatAvailable, SeatLimitExceededError } from '@aivoryx/billing';

try {
  assertSeatAvailable({ seatLimit: subscription.seatLimit, activeMemberCount, invitedMemberCount });
  // proceed to add the member
} catch (error) {
  if (error instanceof SeatLimitExceededError) {
    // reject the request — organization is at its seat limit
  }
  throw error;
}
```

## Tests

```bash
pnpm --filter @aivoryx/billing test
```

No external services required — this package has no database or network dependency.
