import { Dialog as D } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface DialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}

/** Accessible modal (focus trap, Escape to close, labelled by its title). */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: DialogProps) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-slate-900/50" />
        <D.Content
          className={cn(
            'fixed top-1/2 left-1/2 z-50 max-h-[90vh] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2',
            'space-y-4 overflow-y-auto rounded-lg border border-slate-200 bg-white p-6 shadow-xl',
            'dark:border-slate-700 dark:bg-slate-900',
            className,
          )}
        >
          <div className="space-y-1">
            <D.Title className="text-lg font-semibold">{title}</D.Title>
            {description ? (
              <D.Description className="text-sm text-slate-600 dark:text-slate-400">
                {description}
              </D.Description>
            ) : (
              <D.Description className="sr-only">{title}</D.Description>
            )}
          </div>
          {children}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
