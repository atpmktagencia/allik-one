import { describe, expect, it } from "vitest";
import { prescriptionMetadataInput } from "@/data/prescription-input";

const valid = {
  treatmentId: "11111111-1111-4111-8111-111111111111",
  prescriberName: "Dra. Maria Silva",
  councilNumber: "CRM 12345",
  councilRegion: "CE",
  issuedOn: "2026-10-11",
  validUntil: "2027-04-11",
  supersedesId: "",
  reason: "Prescrição conferida para o tratamento informado.",
};

describe("prescription metadata", () => {
  it("accepts structured prescriber and validity data", () => {
    expect(prescriptionMetadataInput.safeParse(valid).success).toBe(true);
  });

  it("rejects expiration before issue and incomplete professional identity", () => {
    expect(
      prescriptionMetadataInput.safeParse({
        ...valid,
        prescriberName: "",
        validUntil: "2026-10-10",
      }).success,
    ).toBe(false);
  });
});
