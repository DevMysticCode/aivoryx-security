import type { AssetType } from '@aivoryx/shared-types';
import type { ReportFindingInput } from './plugin.js';

/**
 * A passive check analyzes an already-collected observation and returns
 * zero or more findings. It is PURE and SYNCHRONOUS by design — a passive
 * check must never make its own outbound request; the whole point of this
 * architecture is one controlled HTTP observation feeding many deterministic
 * analyses. See Part A/Y.
 */
export interface PassiveCheckContext {
  /** The URL findings should be attributed to (used in evidence/fingerprinting). */
  target: string;
  assetType: AssetType;
}

export interface PassiveCheck<TObservation> {
  name: string;
  category: string;
  run(observation: TObservation, context: PassiveCheckContext): ReportFindingInput[];
}

/**
 * Validates a set of passive checks has no duplicate names (Part R) and
 * returns it unchanged — call this once when building a registry, not per
 * execution.
 */
export function createPassiveCheckRegistry<TObservation>(
  checks: readonly PassiveCheck<TObservation>[],
): readonly PassiveCheck<TObservation>[] {
  const seen = new Set<string>();
  for (const check of checks) {
    if (seen.has(check.name)) {
      throw new Error(`Duplicate passive check name registered: "${check.name}"`);
    }
    seen.add(check.name);
  }
  return checks;
}

/**
 * Runs every check in `registry` against the same observation and
 * concatenates their findings. A single check throwing does not abort the
 * others — its error is collected and rethrown after all checks have run,
 * so one broken check can never silently suppress the rest.
 */
export function runPassiveChecks<TObservation>(
  registry: readonly PassiveCheck<TObservation>[],
  observation: TObservation,
  context: PassiveCheckContext,
): ReportFindingInput[] {
  const findings: ReportFindingInput[] = [];
  const errors: { check: string; error: unknown }[] = [];

  for (const check of registry) {
    try {
      findings.push(...check.run(observation, context));
    } catch (error) {
      errors.push({ check: check.name, error });
    }
  }

  if (errors.length > 0) {
    const summary = errors
      .map((e) => `${e.check}: ${e.error instanceof Error ? e.error.message : String(e.error)}`)
      .join('; ');
    throw new Error(`One or more passive checks failed: ${summary}`);
  }

  return findings;
}
