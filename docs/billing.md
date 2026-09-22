# Billing

## Organizations own subscriptions, not users

A subscription belongs to an `organization_id`, never to a `user_id`. Members use
their organization's subscription; a platform administrator is not a customer and is
never subject to this model at all (no `organization_members` row means no seat, no
plan, no billing exposure).

```
organizations (1) ──── (0..n) subscriptions ──── (1) plans
                  └──── (0..n) payments
```

An organization may accumulate historical subscriptions over time (e.g. after a plan
change); the current commercial relationship is whichever subscription is `active`
or `trialing` — this batch does not add a dedicated "current subscription" pointer
column, since an application-level query (most recent non-canceled subscription) is
sufficient at this stage and avoids a second source of truth to keep in sync.

## Plan catalog

`plans` (`packages/db/src/schema.ts`) is the runtime source of truth for an
organization's entitlements — seat/project/assessment/scan limits, feature flags
(`PlanFeatures`), and price. `packages/billing/src/plans.ts` exports `PLAN_CATALOG`,
the reference definitions for the initial four tiers (`STARTER`, `PROFESSIONAL`,
`BUSINESS`, `ENTERPRISE`) — this is seed/reference data and a typed lookup
(`getPlanDefinition(code)`) so plan limits are never hardcoded inline elsewhere in the
codebase; it is not itself authorization logic, and this batch does not seed the
database from it (no seeding script exists yet).

## Provider-agnostic by design

`packages/billing/src/provider.ts` defines `BillingProvider` — `createCustomer`,
`createSubscription`, `cancelSubscription` — the contract a future Stripe (or other)
adapter implements. **No implementation of this interface exists in this batch.** No
Stripe SDK is installed, no network calls are made, no webhooks are handled. The
`subscriptions`/`payments` tables carry only provider-neutral reference columns
(`provider: text`, `provider_subscription_id: text`, `provider_payment_id: text`) —
enough for a future adapter to reconcile with an external system, without any
provider-specific columns leaking into the core schema.

## Payments

`payments` records the _result_ of a billing event (amount, currency, tax, status,
invoice reference/URL, paid-at) — never payment credentials. No card numbers, CVVs, or
other cardholder data are stored anywhere in this schema; a real integration would use
a provider-hosted payment method (e.g. Stripe Elements/Checkout) and only ever receive
a payment _token_ to record here, never raw card data.

## Seats

`packages/billing/src/subscription.ts`:

```ts
computeSeatUsage({ seatLimit, activeMemberCount, invitedMemberCount }): SeatUsage
canAddMember(input): boolean
assertSeatAvailable(input): void   // throws SeatLimitExceededError at the limit
```

- A seat is consumed by any `organization_members` row with status `active` **or**
  `invited` — a pending invite already reserves a seat so an organization cannot
  out-invite its limit while looking like it has room. There is no separate
  invitations table in this batch (membership rows with status `invited` serve that
  purpose); a dedicated invitation model is deferred to a future batch.
- `subscriptions.seat_limit` (not `plans.seat_limit`) is the seat math's source of
  truth — it's normally copied from the plan at subscription creation but may be
  overridden (e.g. a negotiated enterprise deal).
- Platform users structurally cannot consume a tenant seat: seat accounting only ever
  queries `organization_members`, and a platform role lives on `users.platform_role`,
  entirely outside that table. Proven in
  `packages/db/src/domain.integration.test.ts` ("a platform-role user never consumes
  a tenant seat").
- Nothing in this batch silently allows unlimited members — `assertSeatAvailable`
  always throws once `usedSeats >= seatLimit`. Wiring this into an actual
  "invite/add member" HTTP endpoint is deferred (no member-management route exists
  yet in Batch 2's minimal API surface); the enforcement primitive itself is
  implemented and unit-tested now so that endpoint has nothing left to invent later.

## Usage aggregation

`organization_usage` (unique per `organization_id` + `period_start`) is a landing spot
for future periodic rollups (active users, projects, assessments, scans, API calls,
storage, findings) that billing/limits enforcement will read from. This batch only
establishes the table — no aggregation job populates it yet.
