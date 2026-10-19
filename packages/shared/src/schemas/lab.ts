/** Laboratory: test catalogue, orders and results (ERD §3.7, MVP). Synthetic data only. */
import { z } from 'zod';

export const LAB_ORDER_STATUSES = [
  'ordered',
  'collected',
  'resulted',
  'verified',
  'cancelled',
] as const;
export type LabOrderStatus = (typeof LAB_ORDER_STATUSES)[number];
export const LAB_PRIORITIES = ['routine', 'urgent'] as const;
export const ABNORMAL_FLAGS = ['low', 'normal', 'high'] as const;

const text = (label: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} must be at most ${max} characters`);
const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

export const createLabTestSchema = z.strictObject({
  code: z
    .string()
    .trim()
    .regex(/^[A-Z0-9-]{2,20}$/, 'Code: 2–20 capital letters, digits or dashes'),
  name: text('Name', 120),
  sampleType: text('Sample type', 40),
  turnaroundHours: z.int().min(1).max(720),
  pricePaise: z.int().min(0).max(10_000_000),
  parameters: z
    .array(
      z
        .strictObject({
          name: text('Parameter', 80),
          unit: optional(30),
          refLow: z.number().nullable().optional(),
          refHigh: z.number().nullable().optional(),
          refText: optional(120),
        })
        .refine((p) => p.refLow == null || p.refHigh == null || p.refLow <= p.refHigh, {
          path: ['refHigh'],
          message: 'Must not be below the low reference',
        }),
    )
    .min(1)
    .max(40),
});

export const createLabOrderSchema = z.strictObject({
  testIds: z.array(z.uuid()).min(1).max(20),
  priority: z.enum(LAB_PRIORITIES).default('routine'),
  clinicalNotes: optional(500),
});

export const collectSampleSchema = z.strictObject({
  sampleBarcode: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]{4,30}$/, 'Barcode: 4–30 letters, digits or dashes'),
});

export const enterResultsSchema = z.strictObject({
  results: z
    .array(
      z
        .strictObject({
          parameterId: z.uuid(),
          valueNum: z.number().nullable().optional(),
          valueText: optional(200),
        })
        .refine((r) => r.valueNum != null || (r.valueText ?? '') !== '', {
          message: 'Enter a value',
        }),
    )
    .min(1)
    .max(40),
});

export const cancelLabOrderSchema = z.strictObject({ reason: text('Reason', 200) });

export interface LabTestView {
  id: string;
  code: string;
  name: string;
  sampleType: string;
  turnaroundHours: number;
  pricePaise: number;
  active: boolean;
  /** The department the test belongs to; null for general tests every department uses. */
  department: { id: string; name: string } | null;
  parameters: {
    id: string;
    name: string;
    unit: string | null;
    refLow: string | null;
    refHigh: string | null;
    refText: string | null;
  }[];
}

export interface LabResultView {
  parameterId: string;
  parameter: string;
  valueNum: string | null;
  valueText: string | null;
  unit: string | null;
  refLow: string | null;
  refHigh: string | null;
  refText: string | null;
  abnormalFlag: (typeof ABNORMAL_FLAGS)[number] | null;
  enteredAt: string;
}

export interface LabOrderView {
  id: string;
  orderNo: string;
  status: LabOrderStatus;
  priority: (typeof LAB_PRIORITIES)[number];
  clinicalNotes: string | null;
  sampleBarcode: string | null;
  orderedAt: string;
  orderedBy: string;
  collectedAt: string | null;
  resultedAt: string | null;
  resultedBy: string | null;
  verifiedAt: string | null;
  verifiedBy: string | null;
  cancelReason: string | null;
  encounterId: string;
  test: { id: string; code: string; name: string; sampleType: string };
  patient: { id: string; mrn: string; firstName: string; lastName: string };
  doctor: { id: string; fullName: string };
  results: LabResultView[];
}
