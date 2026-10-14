import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import './lib/i18n';
import './index.css';
import { ApiError } from './lib/api';
import { configureTelegramChrome } from './lib/telegram';
import { AdminAuthProvider } from './state/AdminAuth';
import { CustomerAuthProvider } from './state/CustomerAuth';
import { TelegramAutoSignIn } from './state/TelegramAutoSignIn';
import { ToastProvider } from './state/Toast';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        // A 4xx answer from our own API will not fix itself by retrying.
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
    },
  },
});

configureTelegramChrome('#FFFBFE', '#6750A4');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ToastProvider>
          <CustomerAuthProvider>
            <TelegramAutoSignIn />
            <AdminAuthProvider>
              <App />
            </AdminAuthProvider>
          </CustomerAuthProvider>
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
