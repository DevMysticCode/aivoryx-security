import { z } from 'zod';
import { ASSET_TYPES, type AssetType } from '@aivoryx/shared-types';

// One schema per asset type's config shape (packages/shared-types/src/assets.ts).
// Config is validated against the asset's own assetType — an ANDROID asset can
// never be given a WebAssetConfig, etc.

const webAssetConfigSchema = z.object({
  baseUrl: z.string().url(),
  additionalHosts: z.array(z.string()).optional(),
});

const apiAssetConfigSchema = z.object({
  baseUrl: z.string().url(),
  additionalHosts: z.array(z.string()).optional(),
  specReference: z.string().optional(),
});

const androidAssetConfigSchema = z.object({
  packageName: z.string().min(1).max(255),
});

const iosAssetConfigSchema = z.object({
  bundleId: z.string().min(1).max(255),
});

export function assetConfigSchemaFor(assetType: AssetType) {
  switch (assetType) {
    case 'WEB':
      return webAssetConfigSchema;
    case 'API':
      return apiAssetConfigSchema;
    case 'ANDROID':
      return androidAssetConfigSchema;
    case 'IOS':
      return iosAssetConfigSchema;
  }
}

export const createAssetBodySchema = z.object({
  assetType: z.enum(ASSET_TYPES),
  name: z.string().trim().min(1).max(200),
  description: z.string().max(2_000).optional(),
  // Validated against assetConfigSchemaFor(assetType) after this parse — kept
  // as z.record here because the shape depends on a sibling field zod can't
  // express in one pass.
  config: z.record(z.unknown()),
});

export const updateAssetBodySchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(2_000).optional(),
  status: z.enum(['active', 'archived']).optional(),
  config: z.record(z.unknown()).optional(),
  authorizationConfirmed: z.boolean().optional(),
});
