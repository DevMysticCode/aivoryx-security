import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { applyBrandColors } from './applyBrandColors';
import { useOrganization } from '../organization/OrganizationContext';
import { useSession } from '../auth/SessionContext';

export type Appearance = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  appearance: Appearance;
  resolvedMode: 'light' | 'dark';
  setAppearance: (appearance: Appearance) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = 'aivoryx.appearance';

function readStoredAppearance(): Appearance {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    // ignore — fall through to the default
  }
  return 'system';
}

function systemPrefersDark(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

/**
 * Appearance (light/dark/system) is a per-user preference, stored only in
 * this browser — it is never derived from, or overridden by, a tenant's
 * organization theme. Brand colors are the opposite: they always come from
 * the current organization (or the Aivoryx default when there isn't one)
 * regardless of which appearance the user has chosen. See Batch 7 Part 26.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearanceState] = useState<Appearance>(() => readStoredAppearance());
  const { currentOrganization } = useOrganization();
  const { isPlatformAdmin } = useSession();

  const resolvedMode =
    appearance === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : appearance;

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedMode;
  }, [resolvedMode]);

  useEffect(() => {
    if (appearance !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = () => {
      document.documentElement.dataset.theme = media.matches ? 'dark' : 'light';
    };
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, [appearance]);

  useEffect(() => {
    // Platform Admin has no organization context — always the default brand.
    if (isPlatformAdmin || !currentOrganization) {
      applyBrandColors(null);
      return;
    }
    applyBrandColors({
      primaryColor: currentOrganization.primaryColor,
      secondaryColor: currentOrganization.secondaryColor,
      accentColor: currentOrganization.accentColor,
    });
  }, [isPlatformAdmin, currentOrganization]);

  const setAppearance = (next: Appearance) => {
    setAppearanceState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // best-effort only
    }
  };

  const value = useMemo<ThemeContextValue>(
    () => ({ appearance, resolvedMode, setAppearance }),
    [appearance, resolvedMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within a ThemeProvider');
  return context;
}
