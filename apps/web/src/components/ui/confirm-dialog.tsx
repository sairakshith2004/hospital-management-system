import { useState, type ReactNode } from 'react';
import { Alert } from './alert';
import { Button } from './button';
import { Dialog } from './dialog';
import { FormField } from './form-field';
import { Textarea } from './textarea';

/** "Are you sure?" for consequential actions, optionally asking for a reason. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  pending,
  error,
  reasonLabel,
  children,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  description?: string;
  confirmLabel: string;
  onConfirm(reason: string): void;
  pending?: boolean;
  error?: string | null;
  /** When set, a required reason field is shown. */
  reasonLabel?: string;
  children?: ReactNode;
}) {
  const [reason, setReason] = useState('');
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      {...(description ? { description } : {})}
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          onConfirm(reason.trim());
        }}
      >
        {children}
        {reasonLabel && (
          <FormField id="confirm-reason" label={reasonLabel} required>
            <Textarea maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
          </FormField>
        )}
        {error && <Alert tone="error">{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Go back
          </Button>
          <Button type="submit" disabled={pending || (!!reasonLabel && !reason.trim())}>
            {pending ? 'Working…' : confirmLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
