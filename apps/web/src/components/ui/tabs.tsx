import { cn } from '../../lib/utils';

/** Simple accessible tabs for switching a page between views. */
export function Tabs<T extends string>({
  value,
  onChange,
  tabs,
  label,
}: {
  value: T;
  onChange(v: NoInfer<T>): void;
  tabs: { value: NoInfer<T>; label: string; count?: number }[];
  label: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-700"
    >
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          type="button"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cn(
            '-mb-px border-b-2 px-3 py-2 text-sm',
            value === t.value
              ? 'border-brand-700 font-medium text-brand-800 dark:border-brand-400 dark:text-brand-200'
              : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100',
          )}
        >
          {t.label}
          {t.count !== undefined && (
            <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 text-xs dark:bg-slate-800">
              {t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
