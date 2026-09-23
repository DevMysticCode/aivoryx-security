import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, isUnauthorized, ApiError } from '../lib/api-client';
import type { User } from '../types/api';

interface MeResponse {
  user: User | null;
  principal: { type: 'platform' | 'tenant' } | null;
}

interface SessionContextValue {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  /** True once the user's platform role is known to be set — never used to grant access itself, only to decide what to show; every platform route/action is re-checked server-side. */
  isPlatformAdmin: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name?: string) => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

const ME_QUERY_KEY = ['me'] as const;

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const meQuery = useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: async () => {
      try {
        return await apiClient.get<MeResponse>('/api/v1/me');
      } catch (error) {
        // Not signed in is an expected, non-error state for this query.
        if (isUnauthorized(error)) return { user: null, principal: null } satisfies MeResponse;
        throw error;
      }
    },
    staleTime: 60_000,
  });

  const login = useCallback(
    async (email: string, password: string) => {
      await apiClient.post('/api/v1/auth/login', { email, password });
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
    },
    [queryClient],
  );

  const register = useCallback(
    async (email: string, password: string, name?: string) => {
      await apiClient.post('/api/v1/auth/register', { email, password, name });
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
    },
    [queryClient],
  );

  const logout = useCallback(async () => {
    await apiClient.post('/api/v1/auth/logout');
    queryClient.clear();
    await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
  }, [queryClient]);

  const user = meQuery.data?.user ?? null;

  const value = useMemo<SessionContextValue>(
    () => ({
      user,
      isAuthenticated: user !== null,
      isLoading: meQuery.isLoading,
      isPlatformAdmin: user?.platformRole !== null && user?.platformRole !== undefined,
      login,
      register,
      logout,
    }),
    [user, meQuery.isLoading, login, register, logout],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used within a SessionProvider');
  return context;
}

export function authErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Something went wrong. Please try again.';
}
