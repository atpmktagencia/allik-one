/** Explicit response allowlists: stored historical snapshots remain untouched. */
type Row = Record<string, unknown>;
function object(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Row) : {};
}
function pick(value: unknown, keys: readonly string[]): Row {
  const row = object(value);
  return Object.fromEntries(
    keys
      .filter(
        (key) =>
          Object.hasOwn(row, key) &&
          (row[key] === null ||
            ["string", "number", "boolean"].includes(typeof row[key]) ||
            row[key] instanceof Date),
      )
      .map((key) => [key, row[key] instanceof Date ? (row[key] as Date).toISOString() : row[key]]),
  );
}
const itemCommercial = [
  "prescriptionItemId",
  "productId",
  "pricingDoseId",
  "presentationId",
  "presentationName",
  "quantity",
  "unitSalePrice",
  "subtotalSale",
];
const itemClinical = ["medicationName", "doseQuantity", "doseUnit", "pricingDoseName"];
const itemCosts = [
  "unitEstimatedCost",
  "subtotalEstimatedCost",
  "technicalLossPercent",
  "costSource",
  "costValidOn",
];
export function quoteResponseDto(
  value: unknown,
  access: { canReadCosts: boolean; canReadClinical: boolean },
) {
  if (!value) return null;
  const row = object(value);
  return {
    ...pick(row, [
      "id",
      "totalSale",
      "status",
      "version",
      "issuedAt",
      "approvedAt",
      "declinedAt",
      "paidAt",
      "paymentMethod",
      "paymentReference",
      "updatedAt",
      ...(access.canReadClinical ? ["commercialNotes"] : []),
      ...(access.canReadCosts ? ["estimatedCost", "grossResult"] : []),
    ]),
    items: Array.isArray(row["items"])
      ? row["items"].map((item) =>
          pick(item, [
            ...itemCommercial,
            ...(access.canReadClinical ? itemClinical : []),
            ...(access.canReadCosts ? itemCosts : []),
          ]),
        )
      : [],
  };
}
export function quotePricingOptionDto(value: unknown, canReadCosts: boolean) {
  return pick(value, [
    "id",
    "presentationId",
    "name",
    "doseQuantity",
    "salePrice",
    "productId",
    "presentationName",
    "baseUnit",
    ...(canReadCosts
      ? [
          "materialCost",
          "totalBaseQuantity",
          "acquisitionCost",
          "additionalPresentationCost",
          "technicalLossPercent",
        ]
      : []),
  ]);
}
export function quotePrescriptionDto(value: unknown) {
  if (!value) return null;
  const row = object(value);
  return {
    ...pick(row, ["id", "status", "version"]),
    items: Array.isArray(row["items"])
      ? row["items"].map((i) =>
          pick(i, [
            "id",
            "productId",
            "medicationName",
            "doseQuantity",
            "doseUnit",
            "doseUnitOther",
            "durationAmount",
            "durationUnit",
            "continuousUse",
            "instructions",
            "route",
            "frequencyEvery",
            "frequencyUnit",
            "plannedAdministrations",
            "durationDays",
            "notes",
          ]),
        )
      : [],
  };
}
export function quoteActivationDto(value: unknown) {
  if (!value) return null;
  const row = object(value);
  return {
    ...pick(row, ["quoteId", "patientId", "unitId", "firstScheduledOn", "activated"]),
    items: Array.isArray(row["items"])
      ? row["items"].map((i) => ({
          ...pick(i, [
            "prescriptionItemId",
            "medicationName",
            "productId",
            "doseQuantity",
            "doseUnit",
            "route",
            "quantity",
            "frequencyEvery",
            "frequencyUnit",
            "treatmentId",
          ]),
          dates: Array.isArray(object(i)["dates"])
            ? (object(i)["dates"] as unknown[]).filter(
                (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d),
              )
            : [],
        }))
      : [],
  };
}
