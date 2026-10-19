import type { PrescriptionView } from '@hospitalos/shared';

export interface PharmacyAllergy {
  id: string;
  substance: string;
  reaction: string | null;
  severity: string;
}

export interface PharmacyPrescription extends PrescriptionView {
  allergies: PharmacyAllergy[];
  availability?: {
    itemId: string;
    batches: {
      id: string;
      batchNo: string;
      expiryDate: string;
      qtyOnHand: number;
      salePricePaise: number;
      location: { id: string; name: string };
    }[];
  }[];
  dispensings?: {
    id: string;
    dispenseNo: string;
    dispensedAt: string;
    by: string;
    lines: { product: string; batchNo: string; qty: number; unitPricePaise: number }[];
  }[];
}
