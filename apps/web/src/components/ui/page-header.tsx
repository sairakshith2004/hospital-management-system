import type { ReactNode } from 'react';
import { Link } from 'react-router';

export interface Crumb {
  label: string;
  to?: string;
}

/** Page title, optional breadcrumbs and actions, laid out the same on every page. */
export function PageHeader({
  title,
  crumbs,
  actions,
  description,
}: {
  title: string;
  crumbs?: Crumb[];
  actions?: ReactNode;
  description?: ReactNode;
}) {
  return (
    <div className="space-y-1">
      {crumbs && crumbs.length > 0 && (
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
            {crumbs.map((c, i) => (
              <li key={`${c.label}-${i}`} className="flex items-center gap-1">
                {i > 0 && <span aria-hidden="true">/</span>}
                {c.to ? (
                  <Link className="text-brand-700 hover:underline dark:text-brand-300" to={c.to}>
                    {c.label}
                  </Link>
                ) : (
                  <span aria-current="page">{c.label}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          {title}
        </h1>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {description && <p className="text-sm text-slate-600 dark:text-slate-400">{description}</p>}
    </div>
  );
}
