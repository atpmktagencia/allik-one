import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PatientTreatmentPage } from "@/components/clinic/patient-treatment-page";
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock("@/components/clinic/patient-clinical-plans", () => ({ PatientClinicalPlans: () => null }));
vi.mock("@/components/clinic/patient-document-center", () => ({
  PatientDocumentCenter: () => (
    <label>
      Documento em edição
      <input aria-label="Documento em edição" />
    </label>
  ),
}));
vi.mock("@/data/inventory-api", () => ({
  useInventory: (resource: string) => ({
    data: resource.startsWith("laboratory-history")
      ? { rows: [] }
      : {
          patient: {
            id: "p",
            fullName: "Paciente sintético",
            internalCode: "TEST",
            unitName: "Unidade atual",
            primaryUnitId: "u",
            active: true,
          },
          treatments: [],
          prescriptions: [],
          products: [],
          purchases: [],
          schedule: [],
          supplySummaries: [],
          locations: [],
          encounterHistory: [],
          clinicalHistory: [],
          clinicalProblems: [],
          clinicalAlerts: [],
          canManage: false,
          canConsume: false,
          canManageClinicalProblems: false,
        },
    isPending: false,
    error: null,
  }),
}));
afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});
describe("Patient workspace section links", () => {
  it("restores a section from the URL and keeps the document buffer mounted while switching", async () => {
    window.history.replaceState(null, "", "/pacientes/p#secao=documents");
    render(
      <QueryClientProvider client={new QueryClient()}>
        <PatientTreatmentPage patientId="p" />
      </QueryClientProvider>,
    );
    const input = screen.getByRole("textbox", { name: "Documento em edição" });
    expect(input).toBeVisible();
    fireEvent.change(input, { target: { value: "Rascunho preservado" } });
    fireEvent.click(screen.getByRole("button", { name: "Visão geral" }));
    expect(window.location.hash).toBe("#secao=overview");
    expect(input).not.toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Documentos" }));
    expect(screen.getByRole("textbox", { name: "Documento em edição" })).toHaveValue(
      "Rascunho preservado",
    );
    expect(window.location.hash).toBe("#secao=documents");
  });
});
