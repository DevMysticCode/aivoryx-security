import type { BillingInterval, PlanCode, SubscriptionStatus } from './types.js';

/**
 * The contract a future payment-provider adapter (e.g. Stripe) implements. No
 * implementation of this interface exists yet in this batch — no external
 * network calls, no provider SDK, no webhooks. This exists so the rest of the
 * domain (subscriptions, seat management) can be written against a stable
 * abstraction instead of a specific provider's API shape.
 */

export interface CreateCustomerInput {
  organizationId: string;
  email: string;
  name: string;
}

export interface CreateCustomerResult {
  providerCustomerId: string;
}

export interface CreateSubscriptionInput {
  organizationId: string;
  providerCustomerId: string;
  planCode: PlanCode;
  billingInterval: BillingInterval;
}

export interface CreateSubscriptionResult {
  providerSubscriptionId: string;
  status: SubscriptionStatus;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
}

export interface CancelSubscriptionInput {
  providerSubscriptionId: string;
  atPeriodEnd: boolean;
}

export interface BillingProvider {
  readonly name: string;
  createCustomer(input: CreateCustomerInput): Promise<CreateCustomerResult>;
  createSubscription(input: CreateSubscriptionInput): Promise<CreateSubscriptionResult>;
  cancelSubscription(input: CancelSubscriptionInput): Promise<void>;
}
