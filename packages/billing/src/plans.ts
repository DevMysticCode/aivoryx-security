import type { PlanCode, PlanDefinition } from './types.js';

/**
 * The initial plan catalog. This is seed data / a reference for the `plans`
 * table (packages/db) — the database row is always the runtime source of truth
 * for an organization's actual entitlements. Application code should look up a
 * plan by `code` (never hardcode limits inline) and this catalog exists so the
 * code isn't scattered across the codebase; it is not authorization logic itself.
 */
export const PLAN_CATALOG: readonly PlanDefinition[] = [
  {
    code: 'STARTER',
    name: 'Starter',
    description: 'For small teams getting started with security assessments.',
    seatLimit: 3,
    projectLimit: 2,
    assessmentLimit: 5,
    monthlyScanLimit: 10,
    features: {
      apiAccess: false,
      ssoEnabled: false,
      prioritySupport: false,
      customBranding: false,
    },
    priceAmount: 0,
    priceCurrency: 'USD',
    billingInterval: 'monthly',
  },
  {
    code: 'PROFESSIONAL',
    name: 'Professional',
    description: 'For growing teams running regular assessments.',
    seatLimit: 10,
    projectLimit: 10,
    assessmentLimit: 50,
    monthlyScanLimit: 100,
    features: { apiAccess: true, ssoEnabled: false, prioritySupport: false, customBranding: false },
    priceAmount: 9_900,
    priceCurrency: 'USD',
    billingInterval: 'monthly',
  },
  {
    code: 'BUSINESS',
    name: 'Business',
    description: 'For organizations with dedicated security operations.',
    seatLimit: 25,
    projectLimit: 50,
    assessmentLimit: 250,
    monthlyScanLimit: 1_000,
    features: { apiAccess: true, ssoEnabled: true, prioritySupport: true, customBranding: false },
    priceAmount: 29_900,
    priceCurrency: 'USD',
    billingInterval: 'monthly',
  },
  {
    code: 'ENTERPRISE',
    name: 'Enterprise',
    description: 'Custom limits, SSO, and dedicated support for large organizations.',
    seatLimit: 100,
    projectLimit: 500,
    assessmentLimit: 2_500,
    monthlyScanLimit: 10_000,
    features: { apiAccess: true, ssoEnabled: true, prioritySupport: true, customBranding: true },
    priceAmount: 0, // negotiated — not a self-serve price
    priceCurrency: 'USD',
    billingInterval: 'yearly',
  },
];

export function getPlanDefinition(code: PlanCode): PlanDefinition | undefined {
  return PLAN_CATALOG.find((plan) => plan.code === code);
}
