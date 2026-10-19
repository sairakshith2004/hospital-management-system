import type { InvoiceStatus } from '@hospitalos/shared';
import { Badge } from '../../components/ui/badge';

const TONE = {
  draft: 'neutral',
  issued: 'info',
  partially_paid: 'warning',
  paid: 'success',
  void: 'danger',
} as const;
export const INVOICE_LABEL: Record<InvoiceStatus, string> = {
  draft: 'Draft',
  issued: 'Issued',
  partially_paid: 'Part paid',
  paid: 'Paid',
  void: 'Void',
};
export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  return <Badge tone={TONE[status]}>{INVOICE_LABEL[status]}</Badge>;
}
