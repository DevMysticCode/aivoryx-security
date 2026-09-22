import type {
  AssessmentScope,
  AssessmentType,
  AssetConfig,
  AssetType,
  FindingConfidence,
  FindingSeverity,
} from '@aivoryx/shared-types';
import type { SafeHttpClient } from './http-client.js';

/** Capabilities a worker process declares it has. A scanner may only run on a worker that has all of its requiredCapabilities. See Part K. */
export const WORKER_CAPABILITIES = ['http-egress'] as const;
export type WorkerCapability = (typeof WORKER_CAPABILITIES)[number];

export interface ScannerLogger {
  info: (obj: Record<string, unknown>, msg?: string) => void;
  warn: (obj: Record<string, unknown>, msg?: string) => void;
  error: (obj: Record<string, unknown>, msg?: string) => void;
}

export interface ReportFindingInput {
  title: string;
  description: string;
  severity: FindingSeverity;
  confidence: FindingConfidence;
  category: string;
  /** A short, stable key identifying this specific observation within the category — used to build the dedup fingerprint. */
  key: string;
  /** The URL/host this observation is about — also used to build the dedup fingerprint. */
  target: string;
  /** Structured, already-sanitized evidence. Never pass raw secrets/cookies/auth headers — see Part N. */
  evidence?: Record<string, unknown>;
}

/**
 * The capability-scoped context a scanner receives. Deliberately excludes
 * database/Redis credentials, raw environment variables, and any HTTP client
 * other than the scoped SafeHttpClient — see Part J.
 */
export interface ScannerContext {
  assessment: { id: string; assessmentType: AssessmentType };
  asset: { id: string; assetType: AssetType; config: AssetConfig };
  scope: AssessmentScope;
  httpClient: SafeHttpClient;
  logger: ScannerLogger;
  reportFinding: (input: ReportFindingInput) => Promise<void>;
  signal: AbortSignal;
}

export interface ScannerPlugin {
  name: string;
  supportedAssetTypes: readonly AssetType[];
  supportedAssessmentTypes: readonly AssessmentType[];
  requiredCapabilities: readonly WorkerCapability[];
  run(context: ScannerContext): Promise<void>;
}

export function pluginAppliesTo(
  plugin: ScannerPlugin,
  assetType: AssetType,
  assessmentType: AssessmentType,
): boolean {
  return (
    plugin.supportedAssetTypes.includes(assetType) &&
    plugin.supportedAssessmentTypes.includes(assessmentType)
  );
}

export function workerHasCapabilities(
  plugin: ScannerPlugin,
  workerCapabilities: readonly WorkerCapability[],
): boolean {
  return plugin.requiredCapabilities.every((cap) => workerCapabilities.includes(cap));
}

/** Selects the scanner plugins from `registry` applicable to this asset/assessment type and runnable on this worker. */
export function selectApplicablePlugins(
  registry: readonly ScannerPlugin[],
  assetType: AssetType,
  assessmentType: AssessmentType,
  workerCapabilities: readonly WorkerCapability[],
): ScannerPlugin[] {
  return registry.filter(
    (plugin) =>
      pluginAppliesTo(plugin, assetType, assessmentType) &&
      workerHasCapabilities(plugin, workerCapabilities),
  );
}
