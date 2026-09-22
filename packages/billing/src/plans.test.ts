import { describe, expect, it } from 'vitest';
import { PLAN_CATALOG, getPlanDefinition } from './plans.js';
import { PLAN_CODES } from './types.js';

describe('PLAN_CATALOG', () => {
  it('defines exactly the expected plan codes, each once', () => {
    const codes = PLAN_CATALOG.map((plan) => plan.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.sort()).toEqual([...PLAN_CODES].sort());
  });

  it('every plan has positive limits and a valid billing interval', () => {
    for (const plan of PLAN_CATALOG) {
      expect(plan.seatLimit).toBeGreaterThan(0);
      expect(plan.projectLimit).toBeGreaterThan(0);
      expect(plan.assessmentLimit).toBeGreaterThan(0);
      expect(plan.monthlyScanLimit).toBeGreaterThan(0);
      expect(['monthly', 'yearly']).toContain(plan.billingInterval);
    }
  });

  it('higher tiers grant seat limits at least as large as lower tiers', () => {
    const starter = getPlanDefinition('STARTER');
    const professional = getPlanDefinition('PROFESSIONAL');
    const business = getPlanDefinition('BUSINESS');
    const enterprise = getPlanDefinition('ENTERPRISE');

    expect(starter && professional && business && enterprise).toBeTruthy();
    expect(professional!.seatLimit).toBeGreaterThan(starter!.seatLimit);
    expect(business!.seatLimit).toBeGreaterThan(professional!.seatLimit);
    expect(enterprise!.seatLimit).toBeGreaterThan(business!.seatLimit);
  });
});

describe('getPlanDefinition', () => {
  it('returns undefined for an unknown code', () => {
    // @ts-expect-error deliberately invalid code to prove no runtime match occurs
    expect(getPlanDefinition('NOT_A_PLAN')).toBeUndefined();
  });
});
