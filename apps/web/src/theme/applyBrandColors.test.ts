import { describe, expect, it, beforeEach } from 'vitest';
import { applyBrandColors } from './applyBrandColors';

describe('applyBrandColors', () => {
  beforeEach(() => {
    document.documentElement.style.removeProperty('--color-primary');
    document.documentElement.style.removeProperty('--color-secondary');
    document.documentElement.style.removeProperty('--color-accent');
  });

  it('converts a valid hex color into an R G B custom property', () => {
    applyBrandColors({ primaryColor: '#00A19A' });
    expect(document.documentElement.style.getPropertyValue('--color-primary')).toBe('0 161 154');
  });

  it('ignores an invalid hex value rather than writing raw input as CSS', () => {
    applyBrandColors({ primaryColor: 'not-a-color; }</style><script>alert(1)</script>' });
    expect(document.documentElement.style.getPropertyValue('--color-primary')).toBe('');
  });

  it('clears all brand properties when passed null', () => {
    applyBrandColors({
      primaryColor: '#00A19A',
      secondaryColor: '#231D45',
      accentColor: '#C18A38',
    });
    applyBrandColors(null);
    expect(document.documentElement.style.getPropertyValue('--color-primary')).toBe('');
    expect(document.documentElement.style.getPropertyValue('--color-secondary')).toBe('');
    expect(document.documentElement.style.getPropertyValue('--color-accent')).toBe('');
  });

  it('leaves a color unset when null is passed for that key', () => {
    applyBrandColors({ primaryColor: null, secondaryColor: null, accentColor: null });
    expect(document.documentElement.style.getPropertyValue('--color-primary')).toBe('');
  });
});
