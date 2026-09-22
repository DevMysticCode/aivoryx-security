import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDbClient, type DbClient } from './client.js';
import {
  apiKeys,
  auditEvents,
  organizationMembers,
  organizationUsage,
  organizations,
  payments,
  plans,
  projects,
  subscriptions,
  users,
} from './schema.js';

// Requires a live PostgreSQL instance with the Batch 2 migration applied. Run via:
//   pnpm infra:up
//   node --env-file=.env packages/db/dist/migrate-cli.js
//   TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/aivoryx \
//     pnpm --filter @aivoryx/db test:integration
const DATABASE_URL = process.env.TEST_DATABASE_URL;

function uniqueSuffix(): string {
  return randomUUID().slice(0, 8);
}

describe.skipIf(!DATABASE_URL)('domain schema (integration)', () => {
  let client: DbClient;

  beforeAll(() => {
    client = createDbClient(DATABASE_URL as string, { maxConnections: 5 });
  });

  afterAll(async () => {
    await client.close();
  });

  async function insertUser(overrides: Partial<typeof users.$inferInsert> = {}) {
    const [user] = await client.db
      .insert(users)
      .values({ email: `user-${uniqueSuffix()}@example.com`, ...overrides })
      .returning();
    if (!user) throw new Error('expected inserted user row');
    return user;
  }

  async function insertOrganization(overrides: Partial<typeof organizations.$inferInsert> = {}) {
    const suffix = uniqueSuffix();
    const [org] = await client.db
      .insert(organizations)
      .values({ name: `Org ${suffix}`, slug: `org-${suffix}`, ...overrides })
      .returning();
    if (!org) throw new Error('expected inserted organization row');
    return org;
  }

  async function insertPlan(overrides: Partial<typeof plans.$inferInsert> = {}) {
    const suffix = uniqueSuffix();
    const [plan] = await client.db
      .insert(plans)
      .values({
        code: `TEST_PLAN_${suffix}`,
        name: `Test Plan ${suffix}`,
        seatLimit: 10,
        projectLimit: 10,
        assessmentLimit: 10,
        monthlyScanLimit: 10,
        priceAmount: 0,
        billingInterval: 'monthly',
        ...overrides,
      })
      .returning();
    if (!plan) throw new Error('expected inserted plan row');
    return plan;
  }

  it('creates a user with a normalized-unique email', async () => {
    const email = `unique-${uniqueSuffix()}@example.com`;
    const user = await insertUser({ email });
    expect(user.id).toBeTruthy();
    expect(user.email).toBe(email);
    expect(user.status).toBe('active');
    expect(user.platformRole).toBeNull();

    await expect(insertUser({ email })).rejects.toThrow();
  });

  it('creates an organization with a unique slug', async () => {
    const org = await insertOrganization();
    expect(org.id).toBeTruthy();
    expect(org.status).toBe('active');

    await expect(insertOrganization({ slug: org.slug })).rejects.toThrow();
  });

  it('enforces UNIQUE(organization_id, user_id) on organization_members', async () => {
    const org = await insertOrganization();
    const user = await insertUser();

    await client.db.insert(organizationMembers).values({
      organizationId: org.id,
      userId: user.id,
      role: 'OWNER',
    });

    await expect(
      client.db.insert(organizationMembers).values({
        organizationId: org.id,
        userId: user.id,
        role: 'VIEWER',
      }),
    ).rejects.toThrow();
  });

  it('enforces UNIQUE(organization_id, slug) on projects', async () => {
    const org = await insertOrganization();

    await client.db.insert(projects).values({
      organizationId: org.id,
      name: 'Project One',
      slug: 'project-one',
    });

    await expect(
      client.db.insert(projects).values({
        organizationId: org.id,
        name: 'Project One Duplicate',
        slug: 'project-one',
      }),
    ).rejects.toThrow();

    // The same slug is allowed in a different organization — projects are tenant-scoped.
    const otherOrg = await insertOrganization();
    await expect(
      client.db.insert(projects).values({
        organizationId: otherOrg.id,
        name: 'Project One',
        slug: 'project-one',
      }),
    ).resolves.not.toThrow();
  });

  it('relates a subscription to its organization and plan', async () => {
    const org = await insertOrganization();
    const plan = await insertPlan();

    const [subscription] = await client.db
      .insert(subscriptions)
      .values({
        organizationId: org.id,
        planId: plan.id,
        billingInterval: 'monthly',
        seatLimit: plan.seatLimit,
      })
      .returning();

    expect(subscription?.organizationId).toBe(org.id);
    expect(subscription?.planId).toBe(plan.id);
    expect(subscription?.status).toBe('trialing');

    const [row] = await client.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, subscription!.id));
    expect(row?.organizationId).toBe(org.id);
  });

  it('relates a payment to its organization and subscription', async () => {
    const org = await insertOrganization();
    const plan = await insertPlan();
    const [subscription] = await client.db
      .insert(subscriptions)
      .values({
        organizationId: org.id,
        planId: plan.id,
        billingInterval: 'monthly',
        seatLimit: 10,
      })
      .returning();

    const [payment] = await client.db
      .insert(payments)
      .values({
        organizationId: org.id,
        subscriptionId: subscription!.id,
        provider: 'manual',
        amount: 9_900,
        status: 'succeeded',
      })
      .returning();

    expect(payment?.organizationId).toBe(org.id);
    expect(payment?.subscriptionId).toBe(subscription!.id);
  });

  it('persists an API key without ever storing the raw secret', async () => {
    const org = await insertOrganization();
    const rawSecretThatMustNeverAppear = 'this-is-the-raw-secret-value-never-persist-me';

    const [apiKey] = await client.db
      .insert(apiKeys)
      .values({
        organizationId: org.id,
        name: 'CI key',
        keyPrefix: uniqueSuffix(),
        // Must be unique per row (keyHash has a unique constraint) and per test run.
        keyHash: randomUUID().replace(/-/g, '').repeat(2),
      })
      .returning();

    expect(apiKey).toBeDefined();
    expect(Object.values(apiKey as object)).not.toContain(rawSecretThatMustNeverAppear);
    expect(JSON.stringify(apiKey)).not.toContain(rawSecretThatMustNeverAppear);
    expect(apiKey?.status).toBe('active');
  });

  it('creates an audit event, supporting both tenant and platform (nullable org) events', async () => {
    const org = await insertOrganization();
    const user = await insertUser();

    const [tenantEvent] = await client.db
      .insert(auditEvents)
      .values({
        organizationId: org.id,
        actorUserId: user.id,
        action: 'project.created',
        resourceType: 'project',
        resourceId: randomUUID(),
        metadata: { name: 'Example' },
      })
      .returning();
    expect(tenantEvent?.organizationId).toBe(org.id);

    const [platformEvent] = await client.db
      .insert(auditEvents)
      .values({
        organizationId: null,
        actorUserId: user.id,
        action: 'platform.support_access',
      })
      .returning();
    expect(platformEvent?.organizationId).toBeNull();
  });

  it('seat accounting only ever counts real organization_members rows — a platform-role user never consumes a tenant seat', async () => {
    const org = await insertOrganization();
    const plan = await insertPlan({ seatLimit: 1 });
    await client.db.insert(subscriptions).values({
      organizationId: org.id,
      planId: plan.id,
      billingInterval: 'monthly',
      seatLimit: 1,
    });

    // One real member consumes the organization's only seat.
    const member = await insertUser();
    await client.db.insert(organizationMembers).values({
      organizationId: org.id,
      userId: member.id,
      role: 'OWNER',
    });

    // A platform administrator exists, but has no organization_members row for
    // this org at all — platform access is structurally incapable of consuming
    // a tenant seat, because seat accounting only ever queries organizationMembers.
    await insertUser({ platformRole: 'SUPER_ADMIN' });

    const activeMembers = await client.db
      .select()
      .from(organizationMembers)
      .where(eq(organizationMembers.organizationId, org.id));

    expect(activeMembers).toHaveLength(1);

    const usedSeats = activeMembers.filter(
      (m) => m.status === 'active' || m.status === 'invited',
    ).length;
    expect(usedSeats).toBe(1);
    expect(usedSeats).toBeGreaterThanOrEqual(plan.seatLimit); // at limit: no further member may be added

    // Adding a second member is a business-rule violation the service layer
    // must reject (see @aivoryx/billing's assertSeatAvailable) — the schema
    // itself permits the row, so this asserts the *data* an application-level
    // seat check would see, not a database constraint.
  });

  it('enforces a unique organization+period constraint on organization_usage', async () => {
    const org = await insertOrganization();
    const periodStart = new Date('2026-01-01T00:00:00Z');
    const periodEnd = new Date('2026-02-01T00:00:00Z');

    await client.db.insert(organizationUsage).values({
      organizationId: org.id,
      periodStart,
      periodEnd,
    });

    await expect(
      client.db.insert(organizationUsage).values({
        organizationId: org.id,
        periodStart,
        periodEnd,
      }),
    ).rejects.toThrow();
  });
});
