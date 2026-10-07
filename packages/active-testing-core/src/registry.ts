import type { AssessmentType, AssetType } from '@aivoryx/shared-types';
import type { WorkerCapability } from '@aivoryx/scanner-core';
import type { ActiveTestDefinition } from './types.js';

export class InvalidActiveTestDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidActiveTestDefinitionError';
  }
}

/**
 * Validates a definition before it's allowed into a registry — rejects
 * malformed definitions at registration time rather than discovering the
 * problem mid-assessment. See Batch 8 spec Part 21.
 */
function assertValidDefinition(definition: ActiveTestDefinition): void {
  if (!definition.id.trim()) {
    throw new InvalidActiveTestDefinitionError('Active test definition is missing an id');
  }
  if (definition.safety !== 'SAFE_READ_ONLY') {
    throw new InvalidActiveTestDefinitionError(
      `Active test definition "${definition.id}" declared an unsupported safety classification`,
    );
  }
  if (definition.httpMethod !== 'GET' && definition.httpMethod !== 'HEAD') {
    throw new InvalidActiveTestDefinitionError(
      `Active test definition "${definition.id}" declared an unsupported HTTP method — only GET/HEAD are safe, read-only methods SafeHttpClient allows`,
    );
  }
  if (definition.supportedAssetTypes.length === 0) {
    throw new InvalidActiveTestDefinitionError(
      `Active test definition "${definition.id}" declares no supportedAssetTypes`,
    );
  }
  if (definition.supportedAssessmentTypes.length === 0) {
    throw new InvalidActiveTestDefinitionError(
      `Active test definition "${definition.id}" declares no supportedAssessmentTypes`,
    );
  }
  if (definition.requestBudgetEstimate <= 0) {
    throw new InvalidActiveTestDefinitionError(
      `Active test definition "${definition.id}" must declare a positive requestBudgetEstimate`,
    );
  }
}

/**
 * Builds a validated, duplicate-free registry from a list of definitions.
 * Test definitions are trusted, server-side, in-code constructs — exactly
 * like ScannerPlugin's registry — never persisted and never supplied by a
 * runtime/API caller. See Batch 8 spec Part 4/21.
 */
export function buildActiveTestRegistry(
  definitions: readonly ActiveTestDefinition[],
): readonly ActiveTestDefinition[] {
  const seenIds = new Set<string>();
  for (const definition of definitions) {
    assertValidDefinition(definition);
    if (seenIds.has(definition.id)) {
      throw new InvalidActiveTestDefinitionError(
        `Duplicate active test definition id: "${definition.id}"`,
      );
    }
    seenIds.add(definition.id);
  }
  return definitions;
}

/** No active test definitions ship in production this batch — see Batch 8 spec Part 18/30. The framework exists; nothing is registered yet. */
export const ACTIVE_TEST_REGISTRY: readonly ActiveTestDefinition[] = buildActiveTestRegistry([]);

export function activeTestDefinitionAppliesTo(
  definition: ActiveTestDefinition,
  assetType: AssetType,
  assessmentType: AssessmentType,
): boolean {
  return (
    definition.supportedAssetTypes.includes(assetType) &&
    definition.supportedAssessmentTypes.includes(assessmentType)
  );
}

export function workerHasCapabilitiesForActiveTest(
  definition: ActiveTestDefinition,
  workerCapabilities: readonly WorkerCapability[],
): boolean {
  return definition.requiredCapabilities.every((cap) => workerCapabilities.includes(cap));
}

/** Mirrors scanner-core's selectApplicablePlugins — selects the active test definitions from `registry` applicable to this asset/assessment type and runnable on this worker. */
export function selectApplicableActiveTests(
  registry: readonly ActiveTestDefinition[],
  assetType: AssetType,
  assessmentType: AssessmentType,
  workerCapabilities: readonly WorkerCapability[],
): ActiveTestDefinition[] {
  return registry.filter(
    (definition) =>
      activeTestDefinitionAppliesTo(definition, assetType, assessmentType) &&
      workerHasCapabilitiesForActiveTest(definition, workerCapabilities),
  );
}
