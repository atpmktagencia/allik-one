import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { LaboratoryHistory } from "@/components/clinic/laboratory-history";
import { emptyLaboratoryRow } from "@/lib/laboratory-results";
const mock = vi.hoisted(() => ({ useInventory: vi.fn() }));
vi.mock("@/data/inventory-api", () => ({
  useInventory: mock.useInventory,
  InventoryError: class extends Error {},
}));
vi.mock("@/data/unit-context", () => ({ withSelectedUnit: (url: string) => url + "?unitId=unit" }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
function setup() {
  mock.useInventory.mockReturnValue({
    data: {
      hasMore: false,
      rows: [
        {
          id: "one",
          reviewId: "review",
          documentId: "doc",
          documentTitle: "Original privado.pdf",
          previewUrl: "/private-file",
          payload: {
            ...emptyLaboratoryRow(),
            name: "TSH",
            unit: "µUI/mL",
            result: "0,25",
            collectedOn: "2026-01-01",
            reference: "0,2 a 4",
          },
        },
        {
          id: "two",
          reviewId: "review",
          documentId: "doc",
          documentTitle: "Original privado.pdf",
          previewUrl: "/private-file",
          payload: { ...emptyLaboratoryRow(), name: "TSH", unit: "µUI/mL", result: "<0,1" },
        },
        {
          id: "three",
          reviewId: "review",
          documentId: "doc",
          documentTitle: "Original privado.pdf",
          previewUrl: "/private-file",
          payload: {
            ...emptyLaboratoryRow(),
            name: "Ferritina",
            result: "30",
            collectedOn: "2026-01-01",
          },
        },
      ],
    },
    isPending: false,
    error: null,
    refetch: vi.fn(),
  });
}
it("shows literal values, undated results and private source links without fetching originals", () => {
  setup();
  render(<LaboratoryHistory patientId="patient" />);
  expect(mock.useInventory).toHaveBeenCalledWith("laboratory-history?patientId=patient", {
    enabled: true,
  });
  expect(screen.getByText("Sem data de exame")).toBeInTheDocument();
  expect(screen.getByText("<0,1")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Original privado.pdf" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "TSH" }));
  expect(screen.getByRole("img", { name: "Evolução de TSH, unidade µUI/mL" })).toBeInTheDocument();
  expect(screen.queryByText(/Método não informado: comparação limitada/)).not.toBeInTheDocument();
});
it("searches parameters and exposes empty search feedback", () => {
  setup();
  render(<LaboratoryHistory patientId="patient" />);
  fireEvent.change(screen.getByLabelText("Buscar parâmetro laboratorial"), {
    target: { value: "tsh" },
  });
  expect(screen.queryByRole("button", { name: "Ferritina" })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Buscar parâmetro laboratorial"), {
    target: { value: "inexistente" },
  });
  expect(screen.getByText("Nenhum exame encontrado nesta busca.")).toBeInTheDocument();
});

it("opens the selected original in the contextual viewer without changing the confirmed values", () => {
  setup();
  const onOpenOriginal = vi.fn();
  render(<LaboratoryHistory patientId="patient" compact onOpenOriginal={onOpenOriginal} />);
  expect(screen.getByRole("table", { name: "Tabela longitudinal de exames" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Detalhes de Ferritina: 30" }));
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Ver original: Original privado.pdf",
    }),
  );
  expect(onOpenOriginal).toHaveBeenCalledWith(
    expect.objectContaining({
      documentId: "doc",
      documentTitle: "Original privado.pdf",
      payload: expect.objectContaining({ result: "30" }),
    }),
  );
  expect(screen.getByText("<0,1")).toBeInTheDocument();
  expect(screen.getByText("0,25")).toBeInTheDocument();
});

it("passes date filters to the backend and hides old results for invalid periods", () => {
  setup();
  render(<LaboratoryHistory patientId="patient" />);
  fireEvent.change(screen.getByLabelText("Data inicial dos exames"), {
    target: { value: "2026-02-01" },
  });
  expect(mock.useInventory).toHaveBeenLastCalledWith(
    "laboratory-history?patientId=patient&dateFrom=2026-02-01",
    { enabled: true },
  );
  fireEvent.change(screen.getByLabelText("Data final dos exames"), {
    target: { value: "2026-01-01" },
  });
  expect(screen.getByRole("alert")).toHaveTextContent("Informe um período válido");
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(mock.useInventory).toHaveBeenLastCalledWith(
    "laboratory-history?patientId=patient&dateFrom=2026-02-01&dateTo=2026-01-01",
    { enabled: false },
  );
});
it("windows dates and progressively reveals more parameters without dropping rows", () => {
  const rows = Array.from({ length: 60 }, (_, i) => ({
    id: String(i),
    reviewId: "review",
    documentId: "doc",
    documentTitle: "PDF",
    previewUrl: "/private",
    payload: {
      ...emptyLaboratoryRow(),
      name: `Parâmetro ${String(i).padStart(2, "0")}`,
      result: String(i),
      collectedOn: `2026-${String(Math.floor(i / 20) + 1).padStart(2, "0")}-${String((i % 30) + 1).padStart(2, "0")}`,
    },
  }));
  mock.useInventory.mockReturnValue({
    data: { rows, hasMore: true },
    isPending: false,
    error: null,
    refetch: vi.fn(),
  });
  render(<LaboratoryHistory patientId="patient" />);
  expect(screen.getByText(/50 de 60 exames/)).toBeInTheDocument();
  expect(
    within(screen.getByRole("table").querySelector("thead")!).getAllByRole("columnheader"),
  ).toHaveLength(16);
  expect(screen.getByRole("button", { name: "Datas mais recentes" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Datas anteriores" }));
  expect(screen.getByRole("button", { name: "Datas mais recentes" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Mostrar mais exames" }));
  expect(screen.getByRole("button", { name: "Parâmetro 59" })).toBeInTheDocument();
  expect(screen.getByText(/Há resultados adicionais/)).toBeInTheDocument();
});

it("pages server results without merging and resets the page when dates change", () => {
  setup();
  const initial = mock.useInventory.getMockImplementation()!();
  mock.useInventory.mockReturnValue({
    ...initial,
    data: { ...initial.data, hasMore: true, offset: 0 },
  });
  render(<LaboratoryHistory patientId="patient" />);
  expect(screen.getByRole("button", { name: "Resultados mais recentes" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Resultados anteriores" }));
  expect(mock.useInventory).toHaveBeenLastCalledWith(
    "laboratory-history?patientId=patient&offset=500",
    { enabled: true },
  );
  expect(
    screen.getByText(/Comparação limitada aos resultados desta página. Página 2/),
  ).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Data inicial dos exames"), {
    target: { value: "2026-01-01" },
  });
  expect(mock.useInventory).toHaveBeenLastCalledWith(
    "laboratory-history?patientId=patient&dateFrom=2026-01-01",
    { enabled: true },
  );
  expect(screen.getByRole("button", { name: "Resultados mais recentes" })).toBeDisabled();
});
it("graph labels distinguish result dates and use the primary CSS color directly", () => {
  setup();
  const initial = mock.useInventory.getMockImplementation()!();
  const row = {
    ...initial.data.rows[0],
    payload: { ...initial.data.rows[0].payload, collectedOn: null, reportedOn: "2026-02-01" },
  };
  mock.useInventory.mockReturnValue({
    ...initial,
    data: { rows: [row], hasMore: false, offset: 0 },
  });
  const { container } = render(<LaboratoryHistory patientId="patient" />);
  fireEvent.click(screen.getByRole("button", { name: "TSH" }));
  expect(screen.getByText(/Resultado 01\/02\/2026 ·/)).toBeInTheDocument();
  expect(container.querySelector("circle")).toHaveAttribute("fill", "var(--primary)");
  expect(container.querySelector("circle title")).toHaveTextContent("Resultado 01/02/2026");
});

it("restores laboratory search, dates and expansion after closing and reopening its document view", () => {
  setup();
  const state = {
    current: null as
      import("@/components/clinic/laboratory-history").LaboratoryHistoryViewState | null,
  };
  const first = render(<LaboratoryHistory patientId="patient" viewState={state} />);
  fireEvent.change(screen.getByLabelText("Buscar parâmetro laboratorial"), {
    target: { value: "TSH" },
  });
  fireEvent.change(screen.getByLabelText("Data inicial dos exames"), {
    target: { value: "2026-01-01" },
  });
  fireEvent.click(screen.getByRole("button", { name: "TSH" }));
  fireEvent.scroll(screen.getByRole("table").parentElement!, {
    target: { scrollTop: 32, scrollLeft: 120 },
  });
  first.unmount();
  render(<LaboratoryHistory patientId="patient" viewState={state} />);
  expect(screen.getByRole("table").parentElement!.scrollTop).toBe(32);
  expect(screen.getByRole("table").parentElement!.scrollLeft).toBe(120);
  expect(screen.getByLabelText("Buscar parâmetro laboratorial")).toHaveValue("TSH");
  expect(screen.getByLabelText("Data inicial dos exames")).toHaveValue("2026-01-01");
  expect(screen.getByRole("button", { name: "TSH" })).toHaveAttribute("aria-expanded", "true");
});

it("filters clinical display groups without normalizing incompatible measurements and opens selected result details on demand", () => {
  setup();
  render(<LaboratoryHistory patientId="patient" compact />);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Grupo de exames"), { target: { value: "Tireoide" } });
  expect(screen.getByRole("button", { name: "TSH" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Ferritina" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Detalhes de TSH: 0,25" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText("0,2 a 4")).toBeInTheDocument();
  expect(within(dialog).getByText("01/01/2026")).toBeInTheDocument();
  expect(within(dialog).getByText(/Dados do laboratório e origem/)).toBeInTheDocument();
});

function modalitiesSetup() {
  const rows = [
    { name: "Basófilos (%)", unit: "%", result: "1", reference: "0 a 2" },
    { name: "Basófilos (absoluto)", unit: "/mm³", result: "300", reference: "0 a 100" },
    { name: "Basófilos com unidade não informada", unit: null, result: "7", reference: "0 a 10" },
  ].map((p, i) => ({
    id: `modality-${i}`,
    reviewId: "r",
    documentId: "d",
    documentTitle: "Original sintético",
    previewUrl: "/original",
    payload: {
      ...emptyLaboratoryRow(),
      collectedOn: "2026-01-01",
      method: "Método A",
      material: "Sangue",
      laboratory: "Lab",
      ...p,
    },
  }));
  mock.useInventory.mockReturnValue({
    data: { rows, hasMore: false },
    isPending: false,
    error: null,
    refetch: vi.fn(),
  });
  return rows;
}

it("shows one compact row without provenance or PDF links, with a simple inline switch", () => {
  const rows = modalitiesSetup(),
    snapshot = JSON.stringify(rows);
  const { container } = render(<LaboratoryHistory patientId="patient" compact />);
  expect(container.querySelectorAll('tr[data-main-row="true"]')).toHaveLength(1);
  expect(screen.queryByText(/Método A/)).not.toBeInTheDocument();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Modalidades de Basófilos" }));
  const modes = screen.getByRole("group", { name: "Modalidade principal de Basófilos" });
  expect(
    within(modes)
      .getAllByRole("button")
      .map((b) => b.textContent),
  ).toEqual(["Percentual", "Absoluto", "Não resolvido"]);
  fireEvent.click(within(modes).getByRole("button", { name: "Absoluto" }));
  const main = container.querySelector('tr[data-main-row="true"]') as HTMLElement;
  expect(within(main).getByText("/mm³")).toBeInTheDocument();
  expect(within(main).getByText("0 a 100")).toBeInTheDocument();
  expect(within(main).getByRole("button", { name: "Detalhes de Basófilos: 300" })).toHaveAttribute(
    "title",
    "Acima da referência laboratorial desta coleta.",
  );
  expect(main.querySelector('[data-result-color="red"]')).toBeInTheDocument();
  expect(JSON.stringify(rows)).toBe(snapshot);
});
it("switches graph modalities without mixing values and keeps unresolved values neutral", () => {
  modalitiesSetup();
  const { container } = render(<LaboratoryHistory patientId="patient" compact />);
  fireEvent.click(screen.getByRole("button", { name: "Basófilos" }));
  expect(screen.getByRole("img", { name: "Evolução de Basófilos, unidade %" })).toBeInTheDocument();
  const modes = screen.getByRole("group", { name: "Modalidade principal de Basófilos" });
  fireEvent.click(within(modes).getByRole("button", { name: "Absoluto" }));
  expect(
    screen.getByRole("img", { name: "Evolução de Basófilos, unidade /mm³" }),
  ).toBeInTheDocument();
  expect(container.querySelector("circle title")).toHaveTextContent(": 300 /mm³");
  fireEvent.click(within(modes).getByRole("button", { name: "Não resolvido" }));
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(screen.getByText(/gráfico indisponível/)).toBeInTheDocument();
  expect(
    container.querySelector('tr[data-main-row="true"] [data-result-color="neutral"]'),
  ).toBeInTheDocument();
});
it("keeps modal selection and expansion when returning to the workspace", () => {
  modalitiesSetup();
  const state = {
    current: null as
      import("@/components/clinic/laboratory-history").LaboratoryHistoryViewState | null,
  };
  const first = render(<LaboratoryHistory patientId="patient" viewState={state} />);
  fireEvent.click(screen.getByRole("button", { name: "Modalidades de Basófilos" }));
  fireEvent.click(screen.getByRole("button", { name: "Absoluto" }));
  first.unmount();
  render(<LaboratoryHistory patientId="patient" viewState={state} />);
  expect(screen.getByRole("button", { name: "Absoluto" })).toHaveAttribute("aria-pressed", "true");
});
it("opens Ideal editor, validates and holds a draft without recoloring confirmed results", () => {
  modalitiesSetup();
  const { container } = render(<LaboratoryHistory patientId="patient" compact />);
  expect(container.querySelector('[data-result-color="green"]')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Editar Ideal de Basófilos" }));
  const dialog = screen.getByRole("dialog");
  expect(
    within(dialog).getByText(/persistência com autoria e versão aguarda aprovação/),
  ).toBeInTheDocument();
  fireEvent.change(within(dialog).getByLabelText("Mínimo ideal"), { target: { value: "0" } });
  fireEvent.change(within(dialog).getByLabelText("Máximo ideal"), { target: { value: "1" } });
  fireEvent.change(within(dialog).getByLabelText("Justificativa da meta"), {
    target: { value: "Rascunho sintético para revisão" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Guardar rascunho" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Editar Ideal de Basófilos" })).toHaveTextContent(
    "rascunho",
  );
  expect(container.querySelector('[data-result-color="green"]')).not.toBeInTheDocument();
});

it("renders observations at group end with dates and provenance, never as biomarker rows", () => {
  const original = (id: string, name: string, result: string, collectedOn: string) => ({
    id,
    reviewId: "r",
    documentId: "d",
    documentTitle: "Sintético.pdf",
    previewUrl: "/original",
    payload: { ...emptyLaboratoryRow(), name, result, unit: null, sourcePage: 2, collectedOn },
  });
  const rows = [
    original("h", "Hemácias", "4,630", "2026-01-01"),
    original("o", "Obs", "Hemácias normocíticas.", "2026-01-01"),
    original("p", "Obs", "Conferir documento.", "2026-02-01"),
  ];
  mock.useInventory.mockReturnValue({
    data: { rows, hasMore: false },
    isPending: false,
    error: null,
    refetch: vi.fn(),
  });
  render(<LaboratoryHistory patientId="patient" />);
  const table = screen.getByRole("table", { name: "Tabela longitudinal de exames" });
  expect(table.querySelectorAll('[data-main-row="true"]')).toHaveLength(1);
  expect(screen.queryByRole("button", { name: /^Obs$/ })).not.toBeInTheDocument();
  const observations = screen.getByRole("region", { name: "Observações de Hematologia" });
  expect(within(observations).getByText("Hemácias normocíticas.")).toBeInTheDocument();
  expect(within(observations).getByText("01/01/2026")).toBeInTheDocument();
  const unknown = screen.getByRole("region", { name: "Observações documentais não classificadas" });
  expect(within(unknown).getByText("01/02/2026")).toBeInTheDocument();
  fireEvent.click(within(observations).getByRole("button"));
  expect(screen.getByRole("dialog", { name: "Observação laboratorial" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Sintético.pdf" })).toHaveAttribute(
    "href",
    "/original?unitId=unit#page=2",
  );
});
