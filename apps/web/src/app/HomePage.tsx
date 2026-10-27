import { hospitalToday, type PermissionCode } from '@hospitalos/shared';
import type { ComponentType } from 'react';
import { Card } from '../components/ui/card';
import { useAuth } from '../features/auth/auth-context';
import { DASHBOARD_WIDGETS } from './dashboard-widgets';

export interface DashboardWidget {
  key: string;
  /** Shown to users holding any of these. Each widget loads its own real data. */
  anyOf: PermissionCode[];
  /** Hidden from users holding any of these (a hospital-wide widget already covers it). */
  noneOf?: PermissionCode[];
  Component: ComponentType;
}

function formatLongDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-IN', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** One dashboard for everyone, assembled from the widgets the user's permissions allow. */
export function HomePage() {
  const { user, can } = useAuth();
  if (!user) return null;
  const widgets = DASHBOARD_WIDGETS.filter(
    (w) => w.anyOf.some((p) => can(p)) && !(w.noneOf ?? []).some((p) => can(p)),
  );
  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-2xl border border-sky-100 bg-gradient-to-r from-sky-100 via-violet-50 to-teal-100 px-6 py-7 text-brand-900 shadow-sm shadow-sky-100 md:px-8">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-16 -right-10 size-56 rounded-full bg-white/50"
        />
        <p className="relative text-sm font-medium text-brand-700">
          {formatLongDate(hospitalToday())}
        </p>
        <h1 className="relative mt-1 text-2xl font-bold tracking-tight md:text-3xl">
          Welcome, {user.fullName}
        </h1>
        <p className="relative mt-2 max-w-2xl text-sm text-slate-600">
          Your dashboard shows today&apos;s work for the areas your role covers.
        </p>
      </section>
      {user.roles.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-700 dark:text-slate-300">
            Your account is waiting for a role assignment. An administrator will give you access to
            the parts of HospitalOS you need.
          </p>
        </Card>
      ) : widgets.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-700 dark:text-slate-300">
            Use the menu to open the parts of HospitalOS available to your role.
          </p>
        </Card>
      ) : (
        widgets.map(({ key, Component }) => <Component key={key} />)
      )}
    </div>
  );
}
