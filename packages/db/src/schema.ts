import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// Batch 2 domain schema: identity, tenancy, authorization, and commercial
// foundation. No assessment/scanning/finding tables yet — those are added once
// the scanner architecture lands in a later batch.

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const userStatusEnum = pgEnum('user_status', ['active', 'suspended', 'deactivated']);

// Platform roles operate Aivoryx Security itself and are entirely separate from
// tenant membership — a user with a platform role is not a member of any
// "special" organization and does not consume a tenant seat.
export const platformRoleEnum = pgEnum('platform_role', [
  'SUPER_ADMIN',
  'SUPPORT',
  'BILLING',
  'OPERATIONS',
]);

export const organizationStatusEnum = pgEnum('organization_status', [
  'active',
  'suspended',
  'archived',
]);

export const organizationRoleEnum = pgEnum('organization_role', [
  'OWNER',
  'ADMIN',
  'SECURITY_MANAGER',
  'DEVELOPER',
  'VIEWER',
]);

// 'invited' is a pending membership (no login yet) that already reserves a seat,
// so seat accounting doesn't have to wait for a separate invitations model.
export const membershipStatusEnum = pgEnum('membership_status', ['active', 'invited', 'suspended']);

export const planStatusEnum = pgEnum('plan_status', ['active', 'deprecated', 'archived']);

export const billingIntervalEnum = pgEnum('billing_interval', ['monthly', 'yearly']);

export const subscriptionStatusEnum = pgEnum('subscription_status', [
  'trialing',
  'active',
  'past_due',
  'canceled',
  'expired',
]);

export const paymentStatusEnum = pgEnum('payment_status', [
  'pending',
  'succeeded',
  'failed',
  'refunded',
]);

export const projectStatusEnum = pgEnum('project_status', ['active', 'archived']);

export const apiKeyStatusEnum = pgEnum('api_key_status', ['active', 'revoked']);

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Normalized (lowercased) at the application layer before insert/update —
  // see packages/auth's normalizeEmail — and uniquely indexed here.
  email: text('email').notNull().unique(),
  name: text('name'),
  avatarUrl: text('avatar_url'),
  status: userStatusEnum('status').notNull().default('active'),
  // Nullable: most users have no platform role at all. Presence of a role here
  // is the *entire* platform-access grant — it is never inferred from tenant data.
  platformRole: platformRoleEnum('platform_role'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
});

// ---------------------------------------------------------------------------
// Organizations (tenants)
// ---------------------------------------------------------------------------

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  status: organizationStatusEnum('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Organization memberships (tenant identity)
// ---------------------------------------------------------------------------

export const organizationMembers = pgTable(
  'organization_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: organizationRoleEnum('role').notNull(),
    status: membershipStatusEnum('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgUserUnique: uniqueIndex('organization_members_org_user_unique').on(
      table.organizationId,
      table.userId,
    ),
    orgIdIdx: index('organization_members_org_id_idx').on(table.organizationId),
    userIdIdx: index('organization_members_user_id_idx').on(table.userId),
  }),
);

// ---------------------------------------------------------------------------
// Plans (product catalog)
// ---------------------------------------------------------------------------

/** Feature flags gated by plan tier. Extend as new gated capabilities ship. */
export interface PlanFeatures {
  apiAccess: boolean;
  ssoEnabled: boolean;
  prioritySupport: boolean;
  customBranding: boolean;
}

export const plans = pgTable('plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Stable machine-readable identifier (e.g. 'PROFESSIONAL'); application code
  // should reference plans by code, never by hardcoding a row's UUID.
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  status: planStatusEnum('status').notNull().default('active'),
  seatLimit: integer('seat_limit').notNull(),
  projectLimit: integer('project_limit').notNull(),
  assessmentLimit: integer('assessment_limit').notNull(),
  monthlyScanLimit: integer('monthly_scan_limit').notNull(),
  features: jsonb('features')
    .$type<PlanFeatures>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  // Stored in minor currency units (cents) to avoid floating-point rounding.
  priceAmount: integer('price_amount').notNull(),
  priceCurrency: text('price_currency').notNull().default('USD'),
  billingInterval: billingIntervalEnum('billing_interval').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Subscriptions (an organization's commercial relationship with a plan)
// ---------------------------------------------------------------------------

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'restrict' }),
    status: subscriptionStatusEnum('status').notNull().default('trialing'),
    billingInterval: billingIntervalEnum('billing_interval').notNull(),
    // The seat entitlement actually contracted for this subscription — usually
    // copied from the plan at creation time, but may be overridden (e.g. a
    // negotiated enterprise deal), so this — not plans.seatLimit — is the
    // source of truth for seat math.
    seatLimit: integer('seat_limit').notNull(),
    currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    trialStart: timestamp('trial_start', { withTimezone: true }),
    trialEnd: timestamp('trial_end', { withTimezone: true }),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    // Provider-neutral external reference (e.g. 'stripe' + their subscription id).
    // No provider-specific columns beyond this pair — see packages/billing.
    provider: text('provider'),
    providerSubscriptionId: text('provider_subscription_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgIdIdx: index('subscriptions_org_id_idx').on(table.organizationId),
    planIdIdx: index('subscriptions_plan_id_idx').on(table.planId),
  }),
);

// ---------------------------------------------------------------------------
// Payments (records only — no payment credentials, no live provider calls)
// ---------------------------------------------------------------------------

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    subscriptionId: uuid('subscription_id').references(() => subscriptions.id, {
      onDelete: 'set null',
    }),
    provider: text('provider').notNull(),
    providerPaymentId: text('provider_payment_id'),
    amount: integer('amount').notNull(),
    currency: text('currency').notNull().default('USD'),
    taxAmount: integer('tax_amount').notNull().default(0),
    status: paymentStatusEnum('status').notNull().default('pending'),
    invoiceReference: text('invoice_reference'),
    invoiceUrl: text('invoice_url'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgIdIdx: index('payments_org_id_idx').on(table.organizationId),
    subscriptionIdIdx: index('payments_subscription_id_idx').on(table.subscriptionId),
  }),
);

// ---------------------------------------------------------------------------
// Projects (tenant-owned; never globally accessible by id alone)
// ---------------------------------------------------------------------------

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    status: projectStatusEnum('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgSlugUnique: uniqueIndex('projects_org_slug_unique').on(table.organizationId, table.slug),
    orgIdIdx: index('projects_org_id_idx').on(table.organizationId),
  }),
);

// ---------------------------------------------------------------------------
// API keys (raw secret is NEVER persisted — only a keyed hash + safe prefix)
// ---------------------------------------------------------------------------

export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // Short, non-secret identification prefix (e.g. "avx_ab12cd34"), safe to
    // display/log — used to look up candidate rows before verifying the hash.
    keyPrefix: text('key_prefix').notNull(),
    // HMAC-SHA256 of the raw secret, keyed with CREDENTIAL_MASTER_KEY. See
    // packages/auth/src/api-key.ts for the generation/verification flow.
    keyHash: text('key_hash').notNull().unique(),
    status: apiKeyStatusEnum('status').notNull().default('active'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgIdIdx: index('api_keys_org_id_idx').on(table.organizationId),
    keyPrefixIdx: index('api_keys_key_prefix_idx').on(table.keyPrefix),
  }),
);

// ---------------------------------------------------------------------------
// Audit events (tenant and platform-level)
// ---------------------------------------------------------------------------

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Nullable: platform-level events (e.g. a SUPPORT admin action) have no tenant.
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'set null',
    }),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    // resource_type/resource_id are plain fields, not a foreign key, because the
    // referenced resource type varies (project, member, api_key, subscription, ...).
    resourceType: text('resource_type'),
    resourceId: text('resource_id'),
    // Never store secrets here — see packages/auth's audit service, which strips
    // known secret-shaped fields before this row is written.
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgIdIdx: index('audit_events_org_id_idx').on(table.organizationId),
    actorIdx: index('audit_events_actor_user_id_idx').on(table.actorUserId),
    actionIdx: index('audit_events_action_idx').on(table.action),
    createdAtIdx: index('audit_events_created_at_idx').on(table.createdAt),
  }),
);

// ---------------------------------------------------------------------------
// Organization usage (aggregated; foundation for future billing/limits)
// ---------------------------------------------------------------------------

export const organizationUsage = pgTable(
  'organization_usage',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    activeUsers: integer('active_users').notNull().default(0),
    projectsCount: integer('projects_count').notNull().default(0),
    assessmentsCount: integer('assessments_count').notNull().default(0),
    scansCount: integer('scans_count').notNull().default(0),
    apiCallsCount: integer('api_calls_count').notNull().default(0),
    storageBytes: bigint('storage_bytes', { mode: 'number' }).notNull().default(0),
    findingsCount: integer('findings_count').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgPeriodUnique: uniqueIndex('organization_usage_org_period_unique').on(
      table.organizationId,
      table.periodStart,
    ),
  }),
);

// ---------------------------------------------------------------------------
// Inferred row types
// ---------------------------------------------------------------------------

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;

export type OrganizationMember = typeof organizationMembers.$inferSelect;
export type NewOrganizationMember = typeof organizationMembers.$inferInsert;

export type Plan = typeof plans.$inferSelect;
export type NewPlan = typeof plans.$inferInsert;

export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;

export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;

export type AuditEvent = typeof auditEvents.$inferSelect;
export type NewAuditEvent = typeof auditEvents.$inferInsert;

export type OrganizationUsage = typeof organizationUsage.$inferSelect;
export type NewOrganizationUsage = typeof organizationUsage.$inferInsert;
