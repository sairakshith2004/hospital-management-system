import type { ReactNode } from 'react';
import { ApiStatus } from '../../ApiStatus';
import { LogoMark } from '../../components/ui/logo';

/** The two-panel frame shared by the sign-in and create-account pages. */
export function AuthLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <main className="grid min-h-screen bg-white lg:grid-cols-[1.1fr_1fr] dark:bg-slate-950">
      <section
        aria-label="About HospitalOS"
        className="relative hidden overflow-hidden bg-gradient-to-br from-sky-100 via-white to-teal-100 p-12 text-brand-900 lg:flex lg:flex-col lg:justify-between"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 -right-24 size-96 rounded-full bg-violet-100/70"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-32 -left-16 size-80 rounded-full bg-pink-100/70"
        />
        <div className="relative flex items-center gap-3">
          <LogoMark className="size-11" />
          <p className="text-xl font-bold tracking-tight">HospitalOS</p>
        </div>
        <div className="relative max-w-md space-y-6">
          <p className="text-3xl leading-tight font-semibold">
            One hospital, one record — every department connected.
          </p>
          <ul className="space-y-3 text-sm text-slate-700">
            {[
              'Reception, appointments and doctor queues',
              'Consultations, prescriptions and lab results',
              'Pharmacy dispensing, inventory and billing',
            ].map((line) => (
              <li key={line} className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="inline-flex size-6 items-center justify-center rounded-full bg-teal-100 text-teal-700"
                >
                  ✓
                </span>
                {line}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-slate-500">
          Access is limited to authorised hospital staff. Activity is audited.
        </p>
      </section>
      <div className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center">
            <LogoMark className="mx-auto mb-3 size-12 lg:hidden" />
            <h1 className="text-2xl font-bold tracking-tight text-brand-900 dark:text-white">
              {title}
            </h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{subtitle}</p>
          </div>
          {children}
          <p className="text-center text-xs text-slate-500 dark:text-slate-400">
            Synthetic data only. Not for real patient information.
          </p>
        </div>
      </div>
      <ApiStatus />
    </main>
  );
}

/** A password box with a show/hide button. */
export function PasswordToggle({ shown, onToggle }: { shown: boolean; onToggle(): void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={shown ? 'Hide password' : 'Show password'}
      aria-pressed={shown}
      className="absolute top-1/2 right-2 -translate-y-1/2 rounded px-2 py-1 text-xs font-medium text-brand-700 hover:bg-slate-100 dark:text-brand-300 dark:hover:bg-slate-800"
    >
      {shown ? 'Hide' : 'Show'}
    </button>
  );
}
