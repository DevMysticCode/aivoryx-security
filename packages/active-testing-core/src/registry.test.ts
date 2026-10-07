import { describe, expect, it } from 'vitest';
import {
  buildActiveTestRegistry,
  InvalidActiveTestDefinitionError,
  selectApplicableActiveTests,
} from './registry.js';
import type { ActiveTestDefinition } from './types.js';

function fixtureDefinition(overrides: Partial<ActiveTestDefinition> = {}): ActiveTestDefinition {
  return {
    id: 'TEST-FIXTURE',
    name: 'Test fixture',
    description: 'A fixture definition for unit tests',
    category: 'test',
    potentialSeverity: 'LOW',
    supportedAssetTypes: ['WEB'],
    supportedAssessmentTypes: ['WEB'],
    safety: 'SAFE_READ_ONLY',
    httpMethod: 'GET',
    requiredCapabilities: ['http-egress'],
    requiresAuthContext: false,
    requestBudgetEstimate: 5,
    version: '1.0.0',
    markers: [],
    mutations: () => [],
    classify: () => null,
    ...overrides,
  };
}

describe('buildActiveTestRegistry', () => {
  it('accepts a well-formed definition', () => {
    const registry = buildActiveTestRegistry([fixtureDefinition()]);
    expect(registry).toHaveLength(1);
  });

  it('rejects a duplicate id', () => {
    expect(() => buildActiveTestRegistry([fixtureDefinition(), fixtureDefinition()])).toThrow(
      InvalidActiveTestDefinitionError,
    );
  });

  it('rejects an unsafe safety classification', () => {
    expect(() =>
      buildActiveTestRegistry([
        fixtureDefinition({ safety: 'POTENTIALLY_STATE_CHANGING' as never }),
      ]),
    ).toThrow(InvalidActiveTestDefinitionError);
  });

  it('rejects a non-GET/HEAD http method', () => {
    expect(() =>
      buildActiveTestRegistry([fixtureDefinition({ httpMethod: 'POST' as never })]),
    ).toThrow(InvalidActiveTestDefinitionError);
  });

  it('rejects a definition with no supported asset types', () => {
    expect(() => buildActiveTestRegistry([fixtureDefinition({ supportedAssetTypes: [] })])).toThrow(
      InvalidActiveTestDefinitionError,
    );
  });

  it('rejects a definition with no supported assessment types', () => {
    expect(() =>
      buildActiveTestRegistry([fixtureDefinition({ supportedAssessmentTypes: [] })]),
    ).toThrow(InvalidActiveTestDefinitionError);
  });

  it('rejects a non-positive request budget estimate', () => {
    expect(() =>
      buildActiveTestRegistry([fixtureDefinition({ requestBudgetEstimate: 0 })]),
    ).toThrow(InvalidActiveTestDefinitionError);
  });

  it('rejects a definition missing an id', () => {
    expect(() => buildActiveTestRegistry([fixtureDefinition({ id: '  ' })])).toThrow(
      InvalidActiveTestDefinitionError,
    );
  });
});

describe('selectApplicableActiveTests', () => {
  const registry = buildActiveTestRegistry([
    fixtureDefinition({
      id: 'WEB-WEB',
      supportedAssetTypes: ['WEB'],
      supportedAssessmentTypes: ['WEB'],
    }),
    fixtureDefinition({
      id: 'API-API',
      supportedAssetTypes: ['API'],
      supportedAssessmentTypes: ['API'],
    }),
    fixtureDefinition({
      id: 'NEEDS-OTHER-CAPABILITY',
      requiredCapabilities: ['http-egress'],
    }),
  ]);

  it('filters by asset type and assessment type', () => {
    const applicable = selectApplicableActiveTests(registry, 'WEB', 'WEB', ['http-egress']);
    expect(applicable.map((d) => d.id)).toEqual(['WEB-WEB', 'NEEDS-OTHER-CAPABILITY']);
  });

  it('excludes definitions whose required capability the worker lacks', () => {
    const applicable = selectApplicableActiveTests(registry, 'WEB', 'WEB', []);
    expect(applicable).toHaveLength(0);
  });

  it('returns an empty array when nothing applies (the production default — zero definitions ship)', () => {
    const applicable = selectApplicableActiveTests([], 'WEB', 'WEB', ['http-egress']);
    expect(applicable).toHaveLength(0);
  });
});
