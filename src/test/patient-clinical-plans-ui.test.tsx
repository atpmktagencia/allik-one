import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PatientClinicalPlans } from "@/components/clinic/patient-clinical-plans";
vi.mock("@tanstack/react-router", () => ({ useBlocker: vi.fn() }));
const state = vi.hoisted(() => ({ canManage: true, requests: [] as string[] }));
vi.mock("@/data/inventory-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/data/inventory-api")>()),
  useInventory: (resource: string) => {
    state.requests.push(resource);
    return {
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
      refetch: vi.fn(async () => ({ data: { plans: [] } })),
    };
  },
}));
afterEach(() => {
  cleanup();
  state.canManage = true;
  state.requests.length = 0;
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
  it("opens encounter procedures with its fixed binding and no default clinical quantity", () => {
    render(
      <PatientClinicalPlans
        patientId="patient"
        appointmentId="11111111-1111-4111-8111-111111111111"
      />,
    );
    expect(screen.getByRole("region", { name: "Procedimentos do atendimento" })).toBeVisible();
    expect(state.requests).toContain(
      "patient-treatment-plans?patientId=patient&appointmentId=11111111-1111-4111-8111-111111111111",
    );
    fireEvent.click(screen.getByRole("button", { name: "Novo plano de procedimentos" }));
    expect(screen.getByLabelText("Tipo do item clínico")).toHaveValue("PROCEDURE");
    expect(screen.getByLabelText("Quantidade por administração")).toHaveValue("");
    const selector = screen.getByLabelText("Atendimento vinculado (fixo)");
    expect(selector).toBeDisabled();
    expect(selector).toHaveValue("11111111-1111-4111-8111-111111111111");
  });
  it("saves the encounter binding at head and every item without inferring dose", async () => {
    const writes: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_path: unknown, init?: RequestInit) => {
        writes.push(JSON.parse(String(init?.body)));
        return Response.json({ data: { id: "saved", version: 1 } });
      }),
    );
    render(
      <PatientClinicalPlans
        patientId="patient"
        appointmentId="11111111-1111-4111-8111-111111111111"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Novo plano de procedimentos" }));
    for (const [label, value] of [
      ["Nome do plano clínico", "Procedimentos sintéticos"],
      ["Data inicial do plano", "2026-10-18"],
      ["Nome do item clínico", "Procedimento sintético"],
      ["Intervalo em dias", "1"],
      ["Duração da etapa (dias)", "10"],
    ])
      fireEvent.change(screen.getByLabelText(label!), { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar procedimentos" }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({
      appointmentId: "11111111-1111-4111-8111-111111111111",
      plan: {
        items: [
          {
            kind: "PROCEDURE",
            appointmentId: "11111111-1111-4111-8111-111111111111",
            stages: [{ doseUnits: null, frequencyPerDay: null }],
          },
        ],
      },
    });
  });
  it("hides procedure creation when the encounter is read-only", () => {
    state.canManage = false;
    render(
      <PatientClinicalPlans
        patientId="patient"
        appointmentId="11111111-1111-4111-8111-111111111111"
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Novo plano de procedimentos" }),
    ).not.toBeInTheDocument();
  });
  it("reports only edited plan drafts, vetoes unit changes and clears the guard on cancellation", () => {
    const onDraftStateChange = vi.fn();
    render(
      <PatientClinicalPlans
        patientId="patient"
        appointmentId="11111111-1111-4111-8111-111111111111"
        onDraftStateChange={onDraftStateChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Novo plano de procedimentos" }));
    expect(onDraftStateChange).toHaveBeenLastCalledWith({ dirty: false, pending: false });
    const beforeEdit = new CustomEvent("allik:before-unit-change", { cancelable: true });
    expect(window.dispatchEvent(beforeEdit)).toBe(true);
    fireEvent.change(screen.getByLabelText("Nome do plano clínico"), {
      target: { value: "Plano em edição" },
    });
    expect(onDraftStateChange).toHaveBeenLastCalledWith({ dirty: true, pending: false });
    expect(
      window.dispatchEvent(new CustomEvent("allik:before-unit-change", { cancelable: true })),
    ).toBe(false);
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Cancelar plano clínico" }));
    expect(onDraftStateChange).toHaveBeenLastCalledWith({ dirty: false, pending: false });
    expect(
      window.dispatchEvent(new CustomEvent("allik:before-unit-change", { cancelable: true })),
    ).toBe(true);
  });
});
