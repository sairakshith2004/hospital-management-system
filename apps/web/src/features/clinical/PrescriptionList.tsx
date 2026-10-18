import type { PrescriptionView } from '@hospitalos/shared';
import { useState } from 'react';
import { Badge, type BadgeTone } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { EmptyState } from '../../components/ui/empty-state';
import { formatDateTime } from '../../lib/format';
import { useAction } from '../../lib/use-api';

const TONE: Record<string, BadgeTone> = {
  issued: 'info',
  partially_dispensed: 'warning',
  dispensed: 'success',
  cancelled: 'neutral',
  closed: 'neutral',
};

export function RxStatus({ status }: { status: string }) {
  return <Badge tone={TONE[status] ?? 'neutral'}>{status.replace('_', ' ')}</Badge>;
}

export function PrescriptionList({
  prescriptions,
  canCancel,
}: {
  prescriptions: PrescriptionView[];
  canCancel: boolean;
}) {
  const [cancelling, setCancelling] = useState<string | null>(null);
  const cancel = useAction<{ reason: string }>(
    'POST',
    () => `/api/prescriptions/${cancelling}/cancel`,
    {
      invalidate: ['/api/encounters', '/api/patients', '/api/pharmacy'],
      onSuccess: () => setCancelling(null),
    },
  );
  if (prescriptions.length === 0) return <EmptyState title="No prescriptions" />;
  return (
    <div className="space-y-3">
      {prescriptions.map((rx) => (
        <div
          key={rx.id}
          className="rounded-md border border-slate-200 p-3 text-sm dark:border-slate-700"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              <span className="font-mono">{rx.rxNo}</span> · {formatDateTime(rx.issuedAt)} ·{' '}
              {rx.doctor.fullName}
            </span>
            <span className="flex items-center gap-2">
              <RxStatus status={rx.status} />
              {canCancel && rx.status === 'issued' && (
                <Button size="sm" variant="ghost" onClick={() => setCancelling(rx.id)}>
                  Cancel
                </Button>
              )}
            </span>
          </div>
          <ul className="mt-2 space-y-1">
            {rx.items.map((i) => (
              <li key={i.id}>
                <span className="font-medium">{i.product}</span> — {i.dose}, {i.frequency},{' '}
                {i.route}
                {i.durationDays ? `, ${i.durationDays} days` : ''} · qty {i.qtyPrescribed}
                {i.qtyDispensed > 0 && (
                  <span className="text-slate-500"> (dispensed {i.qtyDispensed})</span>
                )}
                {i.instructions && (
                  <span className="block text-xs text-slate-500">{i.instructions}</span>
                )}
              </li>
            ))}
          </ul>
          {rx.notes && <p className="mt-1 text-xs text-slate-500">{rx.notes}</p>}
        </div>
      ))}
      <ConfirmDialog
        open={cancelling !== null}
        onOpenChange={(o) => !o && setCancelling(null)}
        title="Cancel prescription"
        confirmLabel="Cancel prescription"
        reasonLabel="Reason"
        pending={cancel.pending}
        error={cancel.error}
        onConfirm={(reason) => cancel.run({ reason })}
      />
    </div>
  );
}
