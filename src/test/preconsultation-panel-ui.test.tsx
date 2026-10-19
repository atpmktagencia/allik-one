import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PreconsultationPanel } from "@/components/clinic/preconsultation-panel";
const mocks = vi.hoisted(() => ({
  useInventory: vi.fn(),
  invalidateQueries: vi.fn(async () => {}),
}));
vi.mock("@/data/inventory-api", async () => {
  const actual =
    await vi.importActual<typeof import("@/data/inventory-api")>("@/data/inventory-api");
  return { ...actual, useInventory: mocks.useInventory };
});
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
function setup() {
  mocks.useInventory.mockReturnValue({
    data: {
      canManage: true,
      canReadAnswers: true,
      invitations: [],
      units: [{ id: "unit", name: "Unidade" }],
      forms: [
        {
          id: "form",
          unitId: "unit",
          title: "Modelo condicional",
          description: "",
          version: 1,
          publishedVersionId: null,
          publishedVersion: null,
          publishedTitle: null,
          questions: [
            { id: "gate", label: "Usa medicamentos?", type: "CHOICE", options: ["Sim", "Não"] },
            { id: "detail", label: "Quais medicamentos?", type: "TEXT" },
          ],
        },
      ],
    },
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  });
  render(<PreconsultationPanel patientId="patient" unitId="unit" />);
  fireEvent.click(screen.getByText("Modelos de questionário"));
  fireEvent.click(screen.getByRole("button", { name: "Editar questionário" }));
}
it("edits a conditional question using an earlier choice and sends the explicit condition", async () => {
  const fetchMock = vi.fn(async (_url: unknown, _init?: RequestInit) =>
    Response.json({ data: {} }),
  );
  vi.stubGlobal("fetch", fetchMock);
  setup();
  fireEvent.change(screen.getByLabelText("Condição da pergunta 2"), { target: { value: "gate" } });
  expect(screen.getByLabelText("Resposta condicional da pergunta 2")).toHaveValue("Sim");
  fireEvent.change(screen.getByLabelText("Resposta condicional da pergunta 2"), {
    target: { value: "Não" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
  expect(body.questions[1].visibleWhen).toEqual({ questionId: "gate", equals: "Não" });
});
it("blocks saving when removing the earlier question leaves an invalid condition", () => {
  setup();
  fireEvent.change(screen.getByLabelText("Condição da pergunta 2"), { target: { value: "gate" } });
  fireEvent.click(screen.getByRole("button", { name: "Remover pergunta 1" }));
  expect(screen.getByRole("button", { name: "Salvar rascunho" })).toBeDisabled();
  expect(screen.getByText(/Revise textos, opções e condições/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Condição da pergunta 1"), { target: { value: "" } });
  expect(screen.getByRole("button", { name: "Salvar rascunho" })).toBeEnabled();
});
