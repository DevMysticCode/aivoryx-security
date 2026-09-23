import { QueryClient } from '@tanstack/react-query';
import { isUnauthorized } from './api-client';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        // Retrying an unauthorized request never succeeds and only delays
        // showing the sign-in state.
        if (isUnauthorized(error)) return false;
        return failureCount < 2;
      },
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});
