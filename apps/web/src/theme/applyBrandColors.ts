// Converts a validated 6-digit hex color into the "R G B" custom-property
// format tokens.css/tailwind.config.ts expect, and applies it through the
// CSSOM (element.style.setProperty) rather than ever building a <style>
// string — there is no code path here that could turn tenant input into
// arbitrary CSS. Values that don't match the strict hex pattern (which the
// backend already enforces, but this is defense in depth) are ignored.

const HEX_COLOR_PATTERN = /^#([0-9a-fA-F]{6})$/;

function hexToRgbTriple(hex: string): string | null {
  const match = HEX_COLOR_PATTERN.exec(hex);
  if (!match) return null;
  const value = match[1] as string;
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `${r} ${g} ${b}`;
}

export interface BrandColors {
  primaryColor?: string | null | undefined;
  secondaryColor?: string | null | undefined;
  accentColor?: string | null | undefined;
}

const PROPERTY_BY_KEY: Record<keyof BrandColors, string> = {
  primaryColor: '--color-primary',
  secondaryColor: '--color-secondary',
  accentColor: '--color-accent',
};

/**
 * Applies (or clears) a tenant's brand colors on the document root. Passing
 * `null` clears back to the stylesheet default (e.g. when switching into a
 * context with no organization, such as the Platform Admin shell).
 */
export function applyBrandColors(colors: BrandColors | null): void {
  const root = document.documentElement;
  for (const key of Object.keys(PROPERTY_BY_KEY) as (keyof BrandColors)[]) {
    const property = PROPERTY_BY_KEY[key];
    const hex = colors?.[key];
    const rgb = hex ? hexToRgbTriple(hex) : null;
    if (rgb) {
      root.style.setProperty(property, rgb);
    } else {
      root.style.removeProperty(property);
    }
  }
}
