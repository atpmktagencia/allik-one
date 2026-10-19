import { afterEach, describe, expect, it } from "vitest";
import { withSelectedUnit } from "@/data/unit-context";
afterEach(() => localStorage.clear());
describe("clinical resource unit context", () => {
  it("preserves encounter A despite a globally selected B", () => {
    localStorage.setItem("allik_inventory_unit", "unit-b");
    expect(withSelectedUnit("/api/v1/inventory/laboratory-history?patientId=p&unitId=unit-a")).toBe(
      "/api/v1/inventory/laboratory-history?patientId=p&unitId=unit-a",
    );
    expect(withSelectedUnit("/api/v1/inventory/patient-timeline?patientId=p&unitId=")).toBe(
      "/api/v1/inventory/patient-timeline?patientId=p&unitId=",
    );
    expect(withSelectedUnit("/api/v1/inventory/patients?search=Ana")).toContain("unitId=unit-b");
  });
});
