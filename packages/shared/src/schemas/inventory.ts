/**
 * Medicines, stock and suppliers (ERD §3.5, §3.8, reduced for the MVP). One set of rules
 * for the API (authoritative) and the web forms. Synthetic catalogue data only.
 */
import { z } from 'zod';

export const LOCATION_KINDS = ['pharmacy', 'store', 'lab', 'opd_room'] as const;
export type LocationKind = (typeof LOCATION_KINDS)[number];

export const STOCK_ITEM_KINDS = ['medicine', 'general'] as const;
export type StockItemKind = (typeof STOCK_ITEM_KINDS)[number];

export const DOSAGE_FORMS = [
  'tablet',
  'capsule',
  'syrup',
  'suspension',
  'injection',
  'ointment',
  'cream',
  'drops',
  'inhaler',
  'powder',
  'gel',
  'solution',
] as const;
export const ROUTES = [
  'oral',
  'topical',
  'iv',
  'im',
  'sc',
  'inhalation',
  'ophthalmic',
  'otic',
  'nasal',
] as const;
export const STRENGTH_UNITS = ['mg', 'g', 'mcg', 'ml', 'IU', '%', 'mg/ml', 'mg/5ml'] as const;

export const BATCH_STATUSES = ['active', 'quarantined', 'recalled'] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

export const MOVEMENT_KINDS = [
  'receipt',
  'dispense',
  'adjustment_in',
  'adjustment_out',
  'damage',
  'expiry_writeoff',
  'transfer_out',
  'transfer_in',
  'transfer_return',
] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];
/** Movements a person makes by hand; each needs a reason. */
export const ADJUSTMENT_KINDS = [
  'adjustment_in',
  'adjustment_out',
  'damage',
  'expiry_writeoff',
] as const;

export const TRANSFER_STATUSES = ['dispatched', 'received', 'rejected'] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

const text = (label: string, max = 120) =>
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
const paise = z.int().min(0).max(100_000_000_00);
const isoDate = z.iso.date('Must be a date (YYYY-MM-DD)');

export const createIngredientSchema = z.strictObject({ name: text('Name', 120) });

export const createMedicineSchema = z.strictObject({
  sku: z
    .string()
    .trim()
    .regex(/^[A-Z0-9-]{3,30}$/, 'SKU: 3–30 capital letters, digits or dashes'),
  brandName: text('Brand name'),
  manufacturer: optional(120),
  dosageForm: z.enum(DOSAGE_FORMS),
  route: z.enum(ROUTES),
  packSize: optional(60),
  baseUnit: text('Unit', 30),
  rxOnly: z.boolean().default(true),
  reorderLevel: z.int().min(0).max(1_000_000).default(0),
  ingredients: z
    .array(
      z.strictObject({
        ingredientId: z.uuid(),
        strengthValue: z.number().positive().max(1_000_000),
        strengthUnit: z.enum(STRENGTH_UNITS),
      }),
    )
    .min(1, 'Add at least one ingredient')
    .max(10),
});
export type CreateMedicineInput = z.infer<typeof createMedicineSchema>;

export const createGeneralItemSchema = z.strictObject({
  sku: z
    .string()
    .trim()
    .regex(/^[A-Z0-9-]{3,30}$/, 'SKU: 3–30 capital letters, digits or dashes'),
  name: text('Name'),
  category: optional(60),
  baseUnit: text('Unit', 30),
  tracksExpiry: z.boolean().default(false),
  reorderLevel: z.int().min(0).max(1_000_000).default(0),
});

export const createSupplierSchema = z.strictObject({
  code: z
    .string()
    .trim()
    .regex(/^[A-Z0-9-]{2,20}$/, 'Code: 2–20 capital letters, digits or dashes'),
  name: text('Name'),
  gstin: optional(15),
  phone: optional(20),
  email: z
    .union([z.literal(''), z.email().max(254)])
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
});

export const goodsReceiptSchema = z.strictObject({
  supplierId: z.uuid(),
  locationId: z.uuid(),
  supplierInvoiceRef: optional(60),
  lines: z
    .array(
      z.strictObject({
        stockItemId: z.uuid(),
        batchNo: z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9/-]{1,30}$/, 'Batch: letters, digits, / or -'),
        /** The last day the batch is valid (a label "03/2027" means 2027-03-31). */
        expiryDate: isoDate.nullable().optional(),
        qty: z.int().positive().max(1_000_000),
        unitCostPaise: paise,
        salePricePaise: paise,
      }),
    )
    .min(1)
    .max(50),
});
export type GoodsReceiptInput = z.infer<typeof goodsReceiptSchema>;

export const stockAdjustmentSchema = z.strictObject({
  batchId: z.uuid(),
  kind: z.enum(ADJUSTMENT_KINDS),
  qty: z.int().positive().max(1_000_000),
  reason: text('Reason', 200),
});

export const batchStatusSchema = z.strictObject({
  status: z.enum(BATCH_STATUSES),
  reason: text('Reason', 200),
});

export const createTransferSchema = z.strictObject({
  fromLocationId: z.uuid(),
  toLocationId: z.uuid(),
  reason: text('Reason', 200),
  lines: z
    .array(z.strictObject({ batchId: z.uuid(), qty: z.int().positive().max(1_000_000) }))
    .min(1)
    .max(50),
});

export const rejectTransferSchema = z.strictObject({ reason: text('Reason', 200) });

export const stockSearchSchema = z.strictObject({
  q: z.string().trim().max(60).default(''),
  locationId: z.uuid().optional(),
  kind: z.enum(STOCK_ITEM_KINDS).optional(),
});

export interface Location {
  id: string;
  code: string;
  name: string;
  kind: LocationKind;
}

export interface Ingredient {
  id: string;
  name: string;
}

export interface Supplier {
  id: string;
  code: string;
  name: string;
  gstin: string | null;
  phone: string | null;
  email: string | null;
  active: boolean;
}

export interface BatchStock {
  id: string;
  batchNo: string;
  expiryDate: string | null;
  qtyOnHand: number;
  status: BatchStatus;
  salePricePaise: number;
  location: { id: string; code: string; name: string; kind: LocationKind };
}

/** One stock item with its ingredients (medicines) and batches. */
export interface StockItemView {
  id: string;
  sku: string;
  kind: StockItemKind;
  name: string;
  baseUnit: string;
  category: string | null;
  reorderLevel: number;
  tracksExpiry: boolean;
  medicine: {
    brandName: string;
    manufacturer: string | null;
    dosageForm: string;
    route: string;
    packSize: string | null;
    rxOnly: boolean;
    ingredients: { id: string; name: string; strengthValue: string; strengthUnit: string }[];
  } | null;
  /** Usable units: active, unexpired batches. */
  totalAvailable: number;
  batches: BatchStock[];
}

export interface StockMovementView {
  id: string;
  kind: MovementKind;
  qty: number;
  balanceAfter: number;
  reason: string | null;
  refType: string | null;
  refId: string | null;
  occurredAt: string;
  performedBy: string;
  batch: { id: string; batchNo: string };
  item: { id: string; sku: string; name: string };
  location: { id: string; code: string; name: string };
}
