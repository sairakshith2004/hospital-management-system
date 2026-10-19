import type { ReactNode } from 'react';

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div
      role="status"
      className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center dark:border-slate-700"
    >
      <p className="font-medium">{title}</p>
      {children && (
        <div className="mt-1 text-sm text-slate-600 dark:text-slate-400">{children}</div>
      )}
    </div>
  );
}
