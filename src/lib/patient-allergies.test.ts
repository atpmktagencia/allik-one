import { describe, expect, it } from "vitest";
import { allergyLabel, resolveAllergies } from "./patient-allergies";
describe("canonical allergy summaries", () => {
  it("never interprets missing information or an empty intake list as a denial", () => {
    for (const data of [{}, { allergies: [] }, null])
      expect(resolveAllergies(data, []).status).toBe("UNKNOWN");
    expect(allergyLabel(resolveAllergies({}, []))).toBe("Alergias: não informadas");
  });
  it("requires an explicit denial and prioritizes active positive evidence", () => {
    expect(resolveAllergies({}, [], "DENIED").status).toBe("DENIED");
    expect(resolveAllergies({}, [{ type: "ALLERGY", title: "Dipirona" }], "DENIED").status).toBe(
      "REPORTED",
    );
    expect(resolveAllergies({ allergies: ["Penicilina"] }, [], "DENIED").status).toBe("REPORTED");
  });
  it("combines intake and active clinical allergies without treating warnings as allergies", () => {
    const summary = resolveAllergies({ allergies: ["dipirona", "Penicilina"] }, [
      { type: "ALLERGY", title: "Dipirona" },
      { type: "WARNING", title: "Outro alerta" },
      { type: "ALLERGY", title: "Inativa", status: "INACTIVE" },
    ]);
    expect(summary.allergies).toEqual(["Dipirona", "Penicilina"]);
  });
  it("keeps reported allergies without details distinct from both unknown and denied", () => {
    expect(allergyLabel(resolveAllergies({}, [], "REPORTED"))).toBe(
      "Alergias relatadas · detalhes pendentes",
    );
  });
});
