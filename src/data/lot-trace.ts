export type LotTrace = {
  lot: {
    id: string;
    number: string;
    expiry: string;
    supplier: string;
    unitCost: string;
    status: string;
    productId: string;
    product: string;
    unit: string;
    productActive: boolean;
  };
  summary: {
    received: string;
    consumed: string;
    adjusted: string;
    ledgerQuantity: string;
    balanceQuantity: string;
    totalEvents: number;
    auditEntries: number;
    auditedEvents: number;
    reconciled: boolean;
  };
  balances: {
    locationId: string;
    location: string;
    active: boolean;
    quantity: string;
    ledgerQuantity: string;
    matches: boolean;
  }[];
  events: {
    id: string;
    date: string;
    type: string;
    quantity: string;
    reference: string;
    reason: string;
    actor: string;
    location: string;
    receiptId: string | null;
    receiptReference: string | null;
    purchaseId: string | null;
    purchaseReference: string | null;
    supplierId: string | null;
    supplier: string | null;
    operationId: string | null;
    origin: string | null;
    destination: string | null;
    applicationId: string | null;
    applicationReference: string | null;
    patientRef: string | null;
    service: string | null;
    professional: string | null;
    audit: { id: string; actor: string; action: string; date: string }[];
  }[];
  nextCursor: string | null;
};

export const movementLabels: Record<string, string> = {
  IN: "Entrada",
  OUT: "Saída",
  TRANSFER: "Transferência",
  ADJUSTMENT: "Ajuste",
  REVERSAL: "Estorno",
};
