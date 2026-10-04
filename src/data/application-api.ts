import type { InventoryPosition } from "./inventory-api";

export type InventoryApplication = {
  id: string;
  reference: string;
  patientRef: string;
  service: string;
  professional: string;
  location: string;
  createdAt: string;
  items: {
    movementId: string;
    productId: string;
    product: string;
    lotId: string;
    lot: string;
    quantity: string;
    unit: string;
  }[];
};

export function fefoPositions(
  positions: InventoryPosition[],
  productId: string,
  locationId: string,
) {
  return positions
    .filter(
      (position) =>
        position.productId === productId &&
        position.locationId === locationId &&
        position.active &&
        position.status === "AVAILABLE" &&
        position.quantity > 0,
    )
    .sort((a, b) => a.expiry.localeCompare(b.expiry) || a.lotId.localeCompare(b.lotId));
}
