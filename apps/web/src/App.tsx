import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import type { PermissionCode } from '@hospitalos/shared';
import type { ReactNode } from 'react';
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
import { RequireAnyPermission, RequirePermission } from './features/auth/RequirePermission';
import { AuditPage } from './features/admin/AuditPage';
import { DoctorsAdminPage } from './features/admin/DoctorsAdminPage';
import { OrganisationPage } from './features/admin/OrganisationPage';
import { SettingsPage } from './features/admin/SettingsPage';
import { StaffPage } from './features/admin/StaffPage';
import { InvoicePage } from './features/billing/InvoicePage';
import { InvoicesPage } from './features/billing/InvoicesPage';
import { ServicesPage } from './features/billing/ServicesPage';
import { EncounterPage } from './features/clinical/EncounterPage';
import { FollowUpsPage } from './features/clinical/FollowUpsPage';
import { MedicinesPage } from './features/clinical/MedicinesPage';
import { PatientChartPage } from './features/clinical/PatientChartPage';
import { CataloguePage } from './features/inventory/CataloguePage';
import { MovementsPage } from './features/inventory/MovementsPage';
import { ReceiptsPage } from './features/inventory/ReceiptsPage';
import { StockPage } from './features/inventory/StockPage';
import { SuppliersPage } from './features/inventory/SuppliersPage';
import { TransfersPage } from './features/inventory/TransfersPage';
import { LabOrderPage } from './features/lab/LabOrderPage';
import { LabTestsPage } from './features/lab/LabTestsPage';
import { LabWorklistPage } from './features/lab/LabWorklistPage';
import { AttendancePage } from './features/operations/AttendancePage';
import { CampaignsPage } from './features/operations/CampaignsPage';
import { EnquiriesPage } from './features/operations/EnquiriesPage';
import { EquipmentPage } from './features/operations/EquipmentPage';
import { ExpensesPage } from './features/operations/ExpensesPage';
import { FinanceSummaryPage } from './features/operations/FinanceSummaryPage';
import { DoctorReportPage } from './features/reports/DoctorReportPage';
import { LeavePage } from './features/operations/LeavePage';
import { DispensePage } from './features/pharmacy/DispensePage';
import { PharmacyQueuePage } from './features/pharmacy/PharmacyQueuePage';
import { DoctorDirectoryPage } from './features/doctors/DoctorDirectoryPage';
import { PatientDetailPage } from './features/patients/PatientDetailPage';
import { PatientFormPage } from './features/patients/PatientFormPage';
import { PatientSearchPage } from './features/patients/PatientSearchPage';
import { AppointmentDetailPage } from './features/scheduling/AppointmentDetailPage';
import { AppointmentsPage } from './features/scheduling/AppointmentsPage';
import { BookAppointmentPage } from './features/scheduling/BookAppointmentPage';
import { QueuePage } from './features/scheduling/QueuePage';

/** A route shown to holders of any of `anyOf` (display only; the API checks again). */
const guarded = (path: string, anyOf: PermissionCode[], element: ReactNode): RouteObject => ({
  path,
  element: <RequireAnyPermission anyOf={anyOf}>{element}</RequireAnyPermission>,
});

const STOCK_VIEW: PermissionCode[] = [
  'medicine:catalog_manage',
  'stock:adjust_pharmacy',
  'stock:adjust_store',
  'goods_receipt:create',
  'stock_transfer:dispatch_pharmacy',
  'stock_transfer:dispatch_store',
  'stock_transfer:receive_pharmacy',
  'stock_transfer:receive_store',
];
const TRANSFERS: PermissionCode[] = STOCK_VIEW.filter((p) => p.startsWith('stock_transfer'));
const LAB: PermissionCode[] = ['lab:process', 'lab_result:enter', 'lab_result:verify'];

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
          {
            path: 'appointments',
            element: (
              <RequireAnyPermission
                anyOf={['appointment:read_all', 'appointment:book', 'queue:read']}
              >
                <AppointmentsPage />
              </RequireAnyPermission>
            ),
          },
          {
            path: 'appointments/new',
            element: (
              <RequirePermission permission="appointment:book">
                <BookAppointmentPage />
              </RequirePermission>
            ),
          },
          {
            path: 'appointments/:id',
            element: (
              <RequirePermission permission="queue:read">
                <AppointmentDetailPage />
              </RequirePermission>
            ),
          },
          {
            path: 'queue',
            element: (
              <RequirePermission permission="queue:read">
                <QueuePage />
              </RequirePermission>
            ),
          },
          guarded('patients/:id/chart', ['patient:read_clinical'], <PatientChartPage />),
          guarded('encounters/:id', ['patient:read_clinical'], <EncounterPage />),
          guarded('medicines', ['medicine:search'], <MedicinesPage />),
          guarded('follow-ups', ['followup:schedule', 'appointment:read_all'], <FollowUpsPage />),
          guarded(
            'pharmacy',
            ['prescription:dispense', 'prescription:close'],
            <PharmacyQueuePage />,
          ),
          guarded(
            'pharmacy/prescriptions/:id',
            ['prescription:dispense', 'prescription:close'],
            <DispensePage />,
          ),
          guarded('inventory/stock', STOCK_VIEW, <StockPage />),
          guarded('inventory/movements', STOCK_VIEW, <MovementsPage />),
          guarded('inventory/catalogue', ['medicine:catalog_manage'], <CataloguePage />),
          guarded(
            'inventory/receipts',
            ['goods_receipt:create', 'supplier:manage'],
            <ReceiptsPage />,
          ),
          guarded('inventory/transfers', TRANSFERS, <TransfersPage />),
          guarded(
            'inventory/suppliers',
            ['supplier:manage', 'goods_receipt:create'],
            <SuppliersPage />,
          ),
          guarded('lab', LAB, <LabWorklistPage />),
          guarded('lab/orders/:id', [...LAB, 'patient:read_clinical'], <LabOrderPage />),
          guarded('lab/tests', [...LAB, 'price:manage', 'lab_order:create'], <LabTestsPage />),
          guarded('billing', ['invoice:read'], <InvoicesPage />),
          guarded('billing/invoices/:id', ['invoice:read'], <InvoicePage />),
          guarded('billing/services', ['invoice:read', 'price:manage'], <ServicesPage />),
          guarded(
            'admin/staff',
            ['user:manage', 'user_role:assign', 'employee:read'],
            <StaffPage />,
          ),
          guarded('admin/organisation', ['department:manage'], <OrganisationPage />),
          guarded('admin/doctors', ['schedule:manage', 'fee:manage'], <DoctorsAdminPage />),
          guarded(
            'admin/settings',
            ['system_settings:manage', 'security_settings:manage', 'operational_settings:manage'],
            <SettingsPage />,
          ),
          guarded('admin/audit', ['audit:read'], <AuditPage />),
          guarded('hr/attendance', ['attendance:manage', 'employee:read'], <AttendancePage />),
          guarded('hr/leave', ['leave:request', 'leave:approve'], <LeavePage />),
          guarded(
            'finance/expenses',
            ['expense:create', 'expense:approve', 'report:finance'],
            <ExpensesPage />,
          ),
          guarded('finance/summary', ['report:finance'], <FinanceSummaryPage />),
          guarded(
            'reports/doctors',
            ['appointment:read_all', 'report:finance', 'encounter:write'],
            <DoctorReportPage view="visits" />,
          ),
          guarded(
            'reports/doctor-earnings',
            ['report:finance', 'encounter:write'],
            <DoctorReportPage view="earnings" />,
          ),
          guarded('equipment', ['equipment:manage', 'maintenance:log'], <EquipmentPage />),
          guarded('enquiries', ['enquiry:manage'], <EnquiriesPage />),
          guarded('campaigns', ['campaign:manage', 'report:marketing'], <CampaignsPage />),
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
