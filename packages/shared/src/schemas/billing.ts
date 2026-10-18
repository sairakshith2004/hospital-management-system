/**
 * Billing (ERD §3.6, MVP): service prices, one invoice per visit, typed invoice lines,
 * gapless invoice and receipt numbers, and payments. Money is integer paise.
 * Discounts, refunds and credit notes are not part of the MVP.
 */
import { z } from 'zod';

export const SERVICE_KINDS = ['consultation', 'lab', 'procedure', 'other'] as const;
export const INVOICE_STATUSES = ['draft', 'issued', 'partially_paid', 'paid', 'void'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export const INVOICE_SOURCE_TYPES = ['consultation', 'dispensing', 'lab', 'manual'] as const;
export type InvoiceSourceType = (typeof INVOICE_SOURCE_TYPES)[number];
export const PAYMENT_METHODS = ['cash', 'card', 'upi', 'bank'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

const text = (label: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} must be at most ${max} characters`);

export const createServiceSchema = z.strictObject({
  code: z
    .string()
    .trim()
    .regex(/^[A-Z0-9-]{2,20}$/, 'Code: 2–20 capital letters, digits or dashes'),
  name: text('Name', 120),
  kind: z.enum(SERVICE_KINDS),
  pricePaise: z.int().min(0).max(10_000_000),
});

export const updateServicePriceSchema = z.strictObject({
  pricePaise: z.int().min(0).max(10_000_000),
  active: z.boolean().optional(),
});

export const addManualLineSchema = z.strictObject({
  serviceId: z.uuid(),
  qty: z.int().min(1).max(1000).default(1),
});

export const recordPaymentSchema = z.strictObject({
  amountPaise: z.int().positive().max(100_000_000),
  method: z.enum(PAYMENT_METHODS),
  reference: z
    .string()
    .trim()
    .max(60)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
  /** A fresh UUID per attempt: a retried request returns the first result. */
  idempotencyKey: z.uuid(),
});

export const voidInvoiceSchema = z.strictObject({ reason: text('Reason', 200) });

export const invoiceListSchema = z.strictObject({
  status: z.enum(INVOICE_STATUSES).optional(),
  patientId: z.uuid().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});

export interface ServiceItem {
  id: string;
  code: string;
  name: string;
  kind: (typeof SERVICE_KINDS)[number];
  pricePaise: number;
  active: boolean;
}

export interface InvoiceLine {
  id: string;
  description: string;
  sourceType: InvoiceSourceType;
  qty: number;
  unitPricePaise: number;
  lineTotalPaise: number;
  isActive: boolean;
}

export interface PaymentView {
  id: string;
  receiptNo: string;
  amountPaise: number;
  method: PaymentMethod;
  reference: string | null;
  receivedAt: string;
  receivedBy: string;
}

export interface InvoiceSummary {
  id: string;
  invoiceNo: string | null;
  status: InvoiceStatus;
  patient: { id: string; mrn: string; firstName: string; lastName: string };
  appointmentId: string | null;
  totalPaise: number;
  paidPaise: number;
  balancePaise: number;
  createdAt: string;
  issuedAt: string | null;
}

export interface InvoiceView extends InvoiceSummary {
  subtotalPaise: number;
  discountPaise: number;
  taxPaise: number;
  voidReason: string | null;
  lines: InvoiceLine[];
  payments: PaymentView[];
  version: number;
}
