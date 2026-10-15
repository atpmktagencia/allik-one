import { describe, expect, it } from "vitest";
import { can, type AuthContext } from "../server/auth";
import {
  canWriteClinicalDocument,
  hasClinicalRegistration,
} from "../server/clinical-professional-policy";
import { documentTypes } from "../lib/clinical-document-content";

function context(role: AuthContext["role"]): AuthContext {
  return {
    user: { id: "individual", name: "Synthetic clinician", email: "clinician@example.test" },
    membershipId: "membership",
    organizationId: "organization",
    role,
    unitIds: ["fortaleza"],
    preview: false,
    integration: null,
  };
}

describe("clinical professional authorization", () => {
  it("grants clinicians care access only inside their authorized unit", () => {
    const clinician = context("CLINICIAN");
    for (const permission of [
      "patients.read",
      "patients.manage",
      "patients.private.read",
      "patients.clinical.manage",
      "quotes.manage",
      "inventory.read",
    ] as const) {
      expect(can(clinician, permission, "fortaleza")).toBe(true);
      expect(can(clinician, permission, "juazeiro")).toBe(false);
    }
    expect(can(clinician, "users.manage", "fortaleza")).toBe(false);
    expect(can(clinician, "inventory.adjust", "fortaleza")).toBe(false);
  });
  it("keeps administrative patient management separate from clinical record access", () => {
    const manager = context("UNIT_MANAGER");
    expect(can(manager, "patients.manage", "fortaleza")).toBe(true);
    expect(can(manager, "patients.private.read", "fortaleza")).toBe(false);
    expect(can(manager, "patients.clinical.manage", "fortaleza")).toBe(false);
  });
  it("does not expand integrations beyond their explicitly granted permissions", () => {
    const clinician = context("CLINICIAN");
    clinician.integration = {
      id: "integration",
      name: "Synthetic integration",
      permissions: ["patients.read"],
    };
    expect(can(clinician, "patients.read", "fortaleza")).toBe(true);
    expect(can(clinician, "patients.clinical.manage", "fortaleza")).toBe(false);
  });
  it("retains scoped medical document policy rather than treating councils as equivalent", () => {
    for (const type of documentTypes) expect(canWriteClinicalDocument("CRM", type)).toBe(true);
    for (const council of ["COREN", "CREFITO", "CRP", "CRN", "CREFONO", "CRO", "CREF"]) {
      expect(canWriteClinicalDocument(council, "INSTRUCTIONS")).toBe(true);
      for (const type of documentTypes.filter((type) => type !== "INSTRUCTIONS")) {
        expect(canWriteClinicalDocument(council, type)).toBe(false);
      }
    }
    expect(canWriteClinicalDocument(null, "INSTRUCTIONS")).toBe(false);
    expect(canWriteClinicalDocument("UNKNOWN", "PRESCRIPTION")).toBe(false);
  });
  it("requires recognized council, registration number and valid region", () => {
    const valid = { professional_council: "CRM", council_number: "12345", council_region: "CE" };
    expect(hasClinicalRegistration(valid)).toBe(true);
    for (const council of ["CRM", "COREN", "CREFITO", "CRP", "CRN", "CREFONO", "CRO", "CREF"]) {
      expect(hasClinicalRegistration({ ...valid, professional_council: council })).toBe(true);
    }
    for (const patch of [
      { professional_council: null },
      { professional_council: "UNKNOWN" },
      { council_number: "" },
      { council_number: "   " },
      { council_region: "" },
      { council_region: "XX" },
    ])
      expect(hasClinicalRegistration({ ...valid, ...patch })).toBe(false);
  });
});
