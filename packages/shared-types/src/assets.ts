export const ASSET_TYPES = ['WEB', 'API', 'ANDROID', 'IOS'] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export const ASSET_STATUSES = ['active', 'archived'] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const ASSET_BUILD_PLATFORMS = ['apk', 'aab', 'ipa'] as const;
export type AssetBuildPlatform = (typeof ASSET_BUILD_PLATFORMS)[number];

// Type-specific asset configuration, stored as the assets.config jsonb column.
// Only identifying metadata lives here — build/version data belongs in
// asset_builds, not in this config.

export interface WebAssetConfig {
  baseUrl: string;
  additionalHosts?: string[];
}

export interface ApiAssetConfig {
  baseUrl: string;
  additionalHosts?: string[];
  /** A reference to an API specification (e.g. an OpenAPI document URL). Stored
   * only — no fetching, parsing, or spec-driven testing happens in this batch. */
  specReference?: string;
}

export interface AndroidAssetConfig {
  packageName: string;
}

export interface IosAssetConfig {
  bundleId: string;
}

export type AssetConfigFor<T extends AssetType> = T extends 'WEB'
  ? WebAssetConfig
  : T extends 'API'
    ? ApiAssetConfig
    : T extends 'ANDROID'
      ? AndroidAssetConfig
      : IosAssetConfig;

export type AssetConfig = WebAssetConfig | ApiAssetConfig | AndroidAssetConfig | IosAssetConfig;

export function isAssetType(value: string): value is AssetType {
  return (ASSET_TYPES as readonly string[]).includes(value);
}
