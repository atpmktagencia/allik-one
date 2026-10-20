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
          payload: { ...emptyLaboratoryRow(), name: "TSH", result: "<0,1" },
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
  expect(screen.getAllByRole("link", { name: "Original privado.pdf" })[0]).toHaveAttribute(
    "href",
    "/private-file?unitId=unit",
  );
  fireEvent.click(screen.getByRole("button", { name: "TSH" }));
  expect(
    screen.getByRole("img", { name: "Evolução de TSH, unidade não informada" }),
  ).toBeInTheDocument();
  expect(screen.getAllByText(/Método não informado: comparação limitada/)).toHaveLength(2);
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
  fireEvent.click(
    within(screen.getByRole("button", { name: "Ferritina" }).closest("tr")!).getByRole("button", {
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
  expect(screen.getAllByRole("columnheader")).toHaveLength(15);
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
  expect(container.querySelector('svg[role="img"] circle')).toHaveAttribute(
    "fill",
    "var(--primary)",
  );
  expect(container.querySelector('svg[role="img"] circle title')).toHaveTextContent(
    "Resultado 01/02/2026",
  );
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

it("filters navigation categories and collapses groups without dropping confirmed entries", () => {
  setup();
  render(<LaboratoryHistory patientId="patient" compact />);
  fireEvent.change(screen.getByLabelText("Grupo de exames"), { target: { value: "Tireoide" } });
  expect(screen.getByRole("button", { name: "TSH" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Ferritina" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Grupo Tireoide" }));
  expect(screen.queryByRole("button", { name: "TSH" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Grupo Tireoide" }));
  expect(screen.getByText("0,25")).toBeInTheDocument();
  expect(screen.getByText("<0,1")).toBeInTheDocument();
});
it("opens literal result details and hands the exact entry to the source viewer", () => {
  setup();
  const onOpenOriginal = vi.fn();
  render(<LaboratoryHistory patientId="patient" compact onOpenOriginal={onOpenOriginal} />);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Detalhes de TSH: 0,25, 01/01/2026" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText("0,2 a 4")).toBeInTheDocument();
  expect(within(dialog).getByText("Unidade não informada")).toBeInTheDocument();
  expect(within(dialog).getByText("Método")).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "Abrir documento original" }));
  expect(onOpenOriginal).toHaveBeenCalledWith(
    expect.objectContaining({ id: "one", payload: expect.objectContaining({ result: "0,25" }) }),
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByText("<0,1")).toBeInTheDocument();
});
it("reverses temporal columns without changing values or joining incompatible series", () => {
  setup();
  const initial = mock.useInventory.getMockImplementation()!();
  mock.useInventory.mockReturnValue({
    ...initial,
    data: {
      ...initial.data,
      rows: [
        ...initial.data.rows,
        {
          ...initial.data.rows[0],
          id: "earlier",
          payload: { ...initial.data.rows[0].payload, result: "0,35", collectedOn: "2025-12-01" },
        },
      ],
    },
  });
  render(<LaboratoryHistory patientId="patient" compact />);
  fireEvent.change(screen.getByLabelText("Ordenação temporal dos exames"), {
    target: { value: "newest" },
  });
  expect(
    screen
      .getAllByRole("columnheader")
      .slice(3)
      .map((cell) => cell.textContent),
  ).toEqual(["01/01/2026", "01/12/2025", "Sem data de exame"]);
  expect(screen.getByText("0,25")).toBeInTheDocument();
  expect(screen.getByText("<0,1")).toBeInTheDocument();
});

it("does not carry a selected result dialog across patients or explicit units", () => {
  setup();
  const view = render(<LaboratoryHistory patientId="patient" unitId="unit-a" compact />);
  fireEvent.click(screen.getByRole("button", { name: "Detalhes de TSH: 0,25, 01/01/2026" }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  view.rerender(<LaboratoryHistory patientId="other-patient" unitId="unit-a" compact />);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
