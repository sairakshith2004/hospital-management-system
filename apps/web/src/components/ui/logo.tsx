import { cn } from '../../lib/utils';

/** HospitalOS mark: a rounded medical cross. Decorative; the product name is always written beside it. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-teal-400 text-white shadow-sm shadow-sky-200',
        className,
      )}
    >
      <svg viewBox="0 0 24 24" className="size-5" fill="currentColor">
        <path d="M9.5 3h5a1 1 0 0 1 1 1v4.5H20a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-4.5V20a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1v-4.5H4a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1h4.5V4a1 1 0 0 1 1-1Z" />
      </svg>
    </span>
  );
}

/** Up to two initials for an avatar circle. */
export function initials(name: string | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (
    ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')).toUpperCase() ||
    '?'
  );
}
