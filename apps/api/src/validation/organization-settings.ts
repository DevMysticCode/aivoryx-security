import { z } from 'zod';

// Strict hex-color validation — the frontend turns these into CSS custom
// properties itself; the backend never stores or serves arbitrary CSS. See
// docs/frontend-architecture.md's "Theming" section and Batch 7 Part 25.
const hexColor = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'must be a 6-digit hex color, e.g. #00A19A');

// Logo/favicon are URL REFERENCES only (Part 24) — no file upload/object
// storage subsystem exists yet, so this validates the reference strictly
// (https only, reasonable length) rather than accepting an arbitrary string
// that could later be rendered unsafely. `javascript:`/`data:` URIs are
// rejected by requiring the https: protocol outright.
const brandImageUrl = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => {
    try {
      return new URL(value).protocol === 'https:';
    } catch {
      return false;
    }
  }, 'must be a valid https:// URL');

export const THEME_PRESETS = ['aivoryx', 'ocean', 'enterprise', 'slate', 'custom'] as const;

export const updateOrganizationProfileSchema = z.object({
  displayName: z.string().trim().max(200).optional(),
  website: z
    .string()
    .trim()
    .max(2048)
    .refine((value) => {
      try {
        return ['https:', 'http:'].includes(new URL(value).protocol);
      } catch {
        return false;
      }
    }, 'must be a valid URL')
    .optional(),
  industry: z.string().trim().max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  contactEmail: z.string().trim().email().max(320).optional(),
  phone: z.string().trim().max(50).optional(),
  address: z.string().trim().max(500).optional(),
  country: z.string().trim().max(100).optional(),
  timezone: z.string().trim().max(100).optional(),
  locale: z.string().trim().max(20).optional(),
  currency: z.string().trim().length(3).optional(),
});

export const updateOrganizationBrandingSchema = z.object({
  logoUrl: brandImageUrl.optional().nullable(),
  darkLogoUrl: brandImageUrl.optional().nullable(),
  faviconUrl: brandImageUrl.optional().nullable(),
});

export const updateOrganizationThemeSchema = z.object({
  themePreset: z.enum(THEME_PRESETS),
  primaryColor: hexColor.optional().nullable(),
  secondaryColor: hexColor.optional().nullable(),
  accentColor: hexColor.optional().nullable(),
});

export type UpdateOrganizationProfileInput = z.infer<typeof updateOrganizationProfileSchema>;
export type UpdateOrganizationBrandingInput = z.infer<typeof updateOrganizationBrandingSchema>;
export type UpdateOrganizationThemeInput = z.infer<typeof updateOrganizationThemeSchema>;
