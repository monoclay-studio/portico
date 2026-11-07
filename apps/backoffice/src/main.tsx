import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createQueryClient, Providers } from './app/providers';
import { createAppRouter } from './app/router';
import { guardSessionChanges } from './app/session-guard';
import { applyTheme } from './app/theme';
import './styles.css';

applyTheme();
const queryClient = createQueryClient();
guardSessionChanges(queryClient);
const router = createAppRouter(queryClient);

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');
createRoot(root).render(
  <StrictMode>
    <Providers queryClient={queryClient}>
      <RouterProvider router={router} />
    </Providers>
  </StrictMode>,
);
