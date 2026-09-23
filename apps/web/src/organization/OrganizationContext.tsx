import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import { useSession } from '../auth/SessionContext';
import type { Organization } from '../types/api';

interface OrganizationContextValue {
  organizations: Organization[];
  currentOrganization: Organization | null;
  isLoading: boolean;
  /**
   * Switches the active organization — only ever accepts an id that is
   * actually present in the server-returned membership list. A stored id
   * from localStorage that no longer appears there (e.g. the membership was
   * removed) is never trusted; see the effect below.
   */
  switchOrganization: (organizationId: string) => void;
}

const OrganizationContext = createContext<OrganizationContextValue | null>(null);

const STORAGE_KEY = 'aivoryx.currentOrganizationId';

function readStoredOrganizationId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredOrganizationId(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Best-effort convenience only — a private window or blocked storage
    // just means the selection won't persist across reloads.
  }
}

export function OrganizationProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, isPlatformAdmin } = useSession();
  const queryClient = useQueryClient();
  const [currentOrganizationId, setCurrentOrganizationId] = useState<string | null>(null);

  const organizationsQuery = useQuery({
    queryKey: ['organizations'],
    queryFn: () => apiClient.get<{ organizations: Organization[] }>('/api/v1/organizations'),
    enabled: isAuthenticated && !isPlatformAdmin,
    staleTime: 30_000,
  });

  const organizations = useMemo(
    () => organizationsQuery.data?.organizations ?? [],
    [organizationsQuery.data],
  );

  useEffect(() => {
    if (organizations.length === 0) return;
    const stored = readStoredOrganizationId();
    const validStoredId = organizations.some((org) => org.id === stored) ? stored : null;
    setCurrentOrganizationId((current) => {
      if (current && organizations.some((org) => org.id === current)) return current;
      return validStoredId ?? organizations[0]?.id ?? null;
    });
  }, [organizations]);

  const switchOrganization = useCallback(
    (organizationId: string) => {
      if (!organizations.some((org) => org.id === organizationId)) return;
      setCurrentOrganizationId(organizationId);
      writeStoredOrganizationId(organizationId);
      void queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] !== 'me' });
    },
    [organizations, queryClient],
  );

  const currentOrganization = organizations.find((org) => org.id === currentOrganizationId) ?? null;

  const value = useMemo<OrganizationContextValue>(
    () => ({
      organizations,
      currentOrganization,
      isLoading: organizationsQuery.isLoading,
      switchOrganization,
    }),
    [organizations, currentOrganization, organizationsQuery.isLoading, switchOrganization],
  );

  return <OrganizationContext.Provider value={value}>{children}</OrganizationContext.Provider>;
}

export function useOrganization(): OrganizationContextValue {
  const context = useContext(OrganizationContext);
  if (!context) throw new Error('useOrganization must be used within an OrganizationProvider');
  return context;
}
