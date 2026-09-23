import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import { SessionProvider } from './auth/SessionContext';
import { OrganizationProvider } from './organization/OrganizationContext';
import { ThemeProvider } from './theme/ThemeContext';
import { ToastProvider } from './components/ui/Toast';
import { AppRouter } from './router';

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <SessionProvider>
          <OrganizationProvider>
            <ThemeProvider>
              <ToastProvider>
                <AppRouter />
              </ToastProvider>
            </ThemeProvider>
          </OrganizationProvider>
        </SessionProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
