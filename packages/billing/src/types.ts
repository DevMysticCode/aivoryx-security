// Provider-neutral billing domain types. No Stripe (or any provider) types leak
// into this file — see provider.ts for the interface a future adapter implements.

export const PLAN_CODES = ['STARTER', 'PROFESSIONAL', 'BUSINESS', 'ENTERPRISE'] as const;
export type PlanCode = (typeof PLAN_CODES)[number];

export type BillingInterval = 'monthly' | 'yearly';

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired';

export type PaymentStatus = 'pending' | 'succeeded' | 'failed' | 'refunded';

export interface PlanFeatures {
  apiAccess: boolean;
  ssoEnabled: boolean;
  prioritySupport: boolean;
  customBranding: boolean;
}

export interface PlanDefinition {
  code: PlanCode;
  name: string;
  description?: string;
  seatLimit: number;
  projectLimit: number;
  assessmentLimit: number;
  monthlyScanLimit: number;
  features: PlanFeatures;
  /** Minor currency units (e.g. cents), never a float. */
  priceAmount: number;
  priceCurrency: string;
  billingInterval: BillingInterval;
}

export interface SubscriptionRecord {
  id: string;
  organizationId: string;
  planCode: PlanCode;
  status: SubscriptionStatus;
  billingInterval: BillingInterval;
  seatLimit: number;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  trialStart: Date | null;
  trialEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  /** Provider-neutral external reference (e.g. 'stripe'), or null if unmanaged. */
  provider: string | null;
  providerSubscriptionId: string | null;
}

export interface PaymentRecord {
  id: string;
  organizationId: string;
  subscriptionId: string | null;
  provider: string;
  providerPaymentId: string | null;
  amount: number;
  currency: string;
  taxAmount: number;
  status: PaymentStatus;
  invoiceReference: string | null;
  invoiceUrl: string | null;
  paidAt: Date | null;
}
