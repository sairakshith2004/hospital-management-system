import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import type { RouteObject } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import type { createBrowserRouter } from 'react-router';
import { AppShell } from './app/AppShell';
import { ForbiddenPage } from './app/ForbiddenPage';
import { HomePage } from './app/HomePage';
import { NotFoundPage } from './app/NotFoundPage';
import { AuthProvider } from './features/auth/AuthProvider';
import { LoginPage } from './features/auth/LoginPage';
import { RequireAuth } from './features/auth/RequireAuth';
import { RequirePermission } from './features/auth/RequirePermission';
import { DoctorDirectoryPage } from './features/doctors/DoctorDirectoryPage';
import { PatientDetailPage } from './features/patients/PatientDetailPage';
import { PatientFormPage } from './features/patients/PatientFormPage';
import { PatientSearchPage } from './features/patients/PatientSearchPage';

/** Every route except /login requires a session. */
export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <HomePage /> },
          { path: 'forbidden', element: <ForbiddenPage /> },
          {
            path: 'patients',
            element: (
              <RequirePermission permission="patient:read_demographics">
                <PatientSearchPage />
              </RequirePermission>
            ),
          },
          {
            path: 'patients/new',
            element: (
              <RequirePermission permission="patient:create">
                <PatientFormPage />
              </RequirePermission>
            ),
          },
          {
            path: 'patients/:id',
            element: (
              <RequirePermission permission="patient:read_demographics">
                <PatientDetailPage />
              </RequirePermission>
            ),
          },
          {
            path: 'patients/:id/edit',
            element: (
              <RequirePermission permission="patient:update_demographics">
                <PatientFormPage />
              </RequirePermission>
            ),
          },
          {
            path: 'doctors',
            element: (
              <RequirePermission permission="schedule:read">
                <DoctorDirectoryPage />
              </RequirePermission>
            ),
          },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
];

export interface AppProps {
  router: ReturnType<typeof createBrowserRouter>;
  queryClient: QueryClient;
}

export function App({ router, queryClient }: AppProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  );
}
