import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PatientClinicalPlans } from "@/components/clinic/patient-clinical-plans";
const state = vi.hoisted(() => ({ canManage: true }));
vi.mock("@/data/inventory-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/data/inventory-api")>()),
  useInventory: () => ({
    data: {
      plans: [],
      canManage: state.canManage,
      targets: {
        products: [],
        catalogItems: [],
        treatments: [],
        appointments: [],
        prescriptionInstances: [],
      },
    },
    isPending: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
afterEach(() => {
  cleanup();
  state.canManage = true;
  vi.unstubAllGlobals();
});
function open() {
  render(<PatientClinicalPlans patientId="patient" />);
  fireEvent.click(screen.getByRole("button", { name: "Abrir plano clínico" }));
}
function fill() {
  fireEvent.click(screen.getByRole("button", { name: "Novo plano clínico" }));
  for (const [label, value] of [
    ["Nome do plano clínico", "Plano sintético"],
    ["Data inicial do plano", "2026-10-18"],
    ["Nome do item clínico", "Item sintético"],
    ["Intervalo em dias", "1"],
    ["Duração da etapa (dias)", "10"],
  ])
    fireEvent.change(screen.getByLabelText(label!), { target: { value } });
}
describe("Independent clinical plan editor", () => {
  it("does not infer a dose or frequency and preserves unknown quantities without automatic requests", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    open();
    fill();
    expect(screen.getByLabelText("Quantidade por administração")).toHaveValue("");
    expect(screen.getByLabelText("Administrações por dia")).toHaveValue(null);
    expect(
      screen.getByText(/Quantidade prevista de administração: Indeterminada/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Quantidade a dispensar: Não informada/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salvar plano clínico" })).toBeEnabled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("requires an exact capacity unit and explicit manual quantity before computing packages", () => {
    open();
    fill();
    fireEvent.click(screen.getByLabelText("Informar quantidade a dispensar"));
    fireEvent.change(screen.getByLabelText("Quantidade a dispensar"), { target: { value: "35" } });
    fireEvent.change(screen.getByLabelText("Unidade de dispensação"), {
      target: { value: "CAPSULE" },
    });
    fireEvent.click(screen.getByLabelText("Informar capacidade da embalagem"));
    fireEvent.change(screen.getByLabelText("Capacidade por embalagem"), {
      target: { value: "30" },
    });
    fireEvent.change(screen.getByLabelText("Unidade da capacidade"), { target: { value: "ML" } });
    expect(screen.getByRole("button", { name: "Salvar plano clínico" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Unidade da capacidade"), {
      target: { value: "CAPSULE" },
    });
    expect(screen.getByRole("button", { name: "Salvar plano clínico" })).toBeEnabled();
    expect(
      screen.getByText(/35 CAPSULE · Embalagens necessárias: 2 embalagem/),
    ).toBeInTheDocument();
  });
  it("fails closed for creation when the server does not authorize clinical management", () => {
    state.canManage = false;
    open();
    expect(screen.queryByRole("button", { name: "Novo plano clínico" })).not.toBeInTheDocument();
  });
});
