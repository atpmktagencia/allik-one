import { DocumentTransferError } from "@/data/patient-document-transfer";
import { createRef, type ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render as renderView,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PatientDocumentCenter,
  type PatientDocumentCenterViewState,
} from "@/components/clinic/patient-document-center";
function render(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderView(ui, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}
const state = vi.hoisted(() => ({
  data: {} as Record<string, unknown>,
  resources: [] as string[],
  refetch: vi.fn(async () => ({ data: {} })),
  transfer: vi.fn(),
}));
vi.mock("@/data/inventory-api", async (original) => ({
  ...(await original<typeof import("@/data/inventory-api")>()),
  useInventory: (resource: string) => {
    state.resources.push(resource);
    return { data: state.data, isPending: false, error: null, refetch: state.refetch };
  },
}));
vi.mock("@/data/patient-document-transfer", async (original) => ({
  ...(await original<typeof import("@/data/patient-document-transfer")>()),
  transferPatientDocument: (...args: unknown[]) => state.transfer(...args),
}));
const document = {
  id: "CLINICAL_DOCUMENT:doc",
  sourceKind: "CLINICAL_DOCUMENT",
  sourceId: "doc",
  revision: 1,
  title: "Solicitação sintética",
  categories: ["EXAM_REQUEST"],
  occurredAt: "2026-10-19T12:00:00Z",
  professionalId: "professional",
  professionalName: "Profissional sintético",
  unitName: "Unidade sintética",
  status: "FINAL",
  contentType: "text/html",
  sizeBytes: null,
  previewUrl: "/api/v1/inventory/patient-document-file?sourceId=doc",
  downloadUrl: null,
  originUrl: "/atendimentos/appointment",
};
function setup(overrides: Record<string, unknown> = {}) {
  state.transfer.mockReset();
  state.transfer.mockResolvedValue("uploaded");
  state.data = {
    documents: [document],
    categories: [
      { id: "EXAM_REQUEST", name: "Solicitação de exames", builtin: true },
      { id: "LAB_RESULT", name: "Resultado laboratorial", builtin: true },
    ],
    professionals: [{ id: "professional", name: "Profissional sintético" }],
    total: 1,
    offset: 0,
    limit: 25,
    hasMore: false,
    canUpload: true,
    canManageCategories: false,
    ...overrides,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ data: { id: "file" } })),
  );
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  state.resources = [];
  state.refetch.mockClear();
});
describe("Patient private document center", () => {
  it("lists source metadata without loading files, uses authorized source actions, and filters exams server-side", () => {
    setup();
    const { rerender } = render(<PatientDocumentCenter patientId="patient" />);
    expect(fetch).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("complementary", { name: "Prévia privada do documento" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Solicitação sintética/ }));
    const preview = screen.getByRole("complementary", { name: "Prévia privada do documento" });
    expect(
      within(preview).getByText("Documento do atendimento · Finalizado · versão 1"),
    ).toBeInTheDocument();
    expect(within(preview).getByRole("link", { name: "Abrir prévia em nova aba" })).toHaveAttribute(
      "href",
      expect.stringContaining("/api/v1/inventory/patient-document-file"),
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByTitle("Prévia privada: Solicitação sintética")).toHaveAttribute(
      "src",
      expect.stringContaining("/api/v1/inventory/patient-document-file"),
    );
    expect(screen.getByTitle("Prévia privada: Solicitação sintética")).toHaveAttribute(
      "sandbox",
      "",
    );
    fireEvent.change(screen.getByLabelText("Profissional"), { target: { value: "professional" } });
    expect(state.resources.at(-1)).toContain("professionalId=professional");
    fireEvent.click(screen.getByRole("button", { name: "Fechar prévia" }));
    expect(
      screen.queryByRole("complementary", { name: "Prévia privada do documento" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Profissional")).toHaveValue("professional");
    rerender(<PatientDocumentCenter patientId="patient" examsOnly />);
    expect(state.resources.at(-1)).toContain("categoryGroup=EXAMS");
    expect(screen.queryByRole("button", { name: /Validar|Extrair/ })).not.toBeInTheDocument();
  });
  it("provides a semantic table and fails closed for upload/category management", () => {
    setup({ canUpload: false, canManageCategories: false });
    render(<PatientDocumentCenter patientId="patient" />);
    expect(screen.queryByRole("button", { name: "Anexar arquivo" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Nova categoria")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tabela" }));
    expect(screen.getByRole("table", { name: "Documentos do paciente" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Profissional" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Próxima" })).toBeDisabled();
  });
  it("clears a selected record on patient/context change", () => {
    setup();
    const { rerender } = render(<PatientDocumentCenter patientId="patient" />);
    fireEvent.click(screen.getByRole("button", { name: /Solicitação sintética/ }));
    expect(screen.getByRole("link", { name: "Abrir registro de origem" })).toBeInTheDocument();
    rerender(<PatientDocumentCenter patientId="other-patient" />);
    expect(
      screen.queryByRole("link", { name: "Abrir registro de origem" }),
    ).not.toBeInTheDocument();
  });
  it("handles unauthorized binary preview without creating a public file URL", async () => {
    setup({
      documents: [{ ...document, sourceKind: "GENERAL_DOCUMENT", contentType: "application/pdf" }],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Denied", { status: 403 })),
    );
    render(<PatientDocumentCenter patientId="patient" />);
    fireEvent.click(screen.getByRole("button", { name: /Solicitação sintética/ }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Não foi possível abrir a prévia privada",
      ),
    );
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/inventory/patient-document-file"),
      expect.objectContaining({ credentials: "same-origin", signal: expect.any(AbortSignal) }),
    );
  });
  it("receives multiple originals neutrally and reuses the operation ID after a network failure", async () => {
    setup();
    const bodies: FormData[] = [];
    state.transfer.mockImplementation(async (_url: string, body: FormData) => {
      bodies.push(body);
      if (bodies.length === 1) throw new Error("Falha de rede");
      return "uploaded";
    });
    render(<PatientDocumentCenter patientId="patient" />);
    const first = new File(["%PDF-1.7 synthetic A"], "primeiro.pdf", { type: "application/pdf" });
    const second = new File(["%PDF-1.7 synthetic B"], "segundo.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText("Selecionar documentos"), {
      target: { files: [first, second] },
    });
    await waitFor(() => expect(state.transfer).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("alert")).toHaveTextContent("Falha de rede");
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("2 de 2"));
    expect(bodies[0]!.get("intent")).toBe("RECEIPT");
    expect(bodies[0]!.get("categories")).toBe('["OTHER"]');
    expect(bodies[0]!.get("id")).toBe(bodies[2]!.get("id"));
    expect(bodies[0]!.get("file")).toBe(first);
    expect(bodies[1]!.get("file")).toBe(second);
    expect(bodies[0]!.get("patientId")).toBe("patient");
    expect(fetch).not.toHaveBeenCalled();
  });
});

it("keeps document filters, selection and view mode across modal unmounts within the same patient/unit", async () => {
  setup();
  const viewState = createRef<PatientDocumentCenterViewState | null>();
  const first = render(
    <PatientDocumentCenter patientId="patient" unitId="unit-a" viewState={viewState} />,
  );
  fireEvent.change(screen.getByLabelText("Buscar documentos"), {
    target: { value: "Solicitação" },
  });
  fireEvent.change(screen.getByLabelText("Profissional"), { target: { value: "professional" } });
  fireEvent.click(screen.getByRole("button", { name: "Tabela" }));
  fireEvent.click(screen.getByRole("button", { name: /Solicitação sintética/ }));
  await waitFor(() => expect(viewState.current?.filters.search).toBe("Solicitação"));
  first.unmount();
  const restored = render(
    <PatientDocumentCenter patientId="patient" unitId="unit-a" viewState={viewState} />,
  );
  expect(screen.getByLabelText("Buscar documentos")).toHaveValue("Solicitação");
  expect(screen.getByLabelText("Profissional")).toHaveValue("professional");
  expect(screen.getByRole("table", { name: "Documentos do paciente" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Abrir registro de origem" })).toBeInTheDocument();
  restored.unmount();
  render(<PatientDocumentCenter patientId="patient" unitId="unit-b" viewState={viewState} />);
  expect(screen.getByLabelText("Buscar documentos")).toHaveValue("");
  expect(screen.queryByRole("link", { name: "Abrir registro de origem" })).not.toBeInTheDocument();
});
it("does not classify new exam-screen uploads as laboratory results by default", async () => {
  setup();
  render(<PatientDocumentCenter patientId="patient" unitId="unit-a" examsOnly />);
  expect(screen.getByRole("checkbox", { name: "Resultado laboratorial" })).not.toBeChecked();
  fireEvent.change(screen.getByLabelText("Selecionar documentos"), {
    target: {
      files: [new File(["%PDF-1.7 synthetic"], "arquivo.pdf", { type: "application/pdf" })],
    },
  });
  await waitFor(() => expect(state.transfer).toHaveBeenCalledTimes(1));
  expect((state.transfer.mock.calls[0]![1] as FormData).get("intent")).toBe("RECEIPT");
  expect(state.resources.at(-1)).toContain("unitId=unit-a");
});

it("accepts a drop, rejects oversized originals individually and never defaults to a clinical category", async () => {
  setup();
  render(<PatientDocumentCenter patientId="patient" />);
  const file = new File(["%PDF-1.7 synthetic"], "drop.pdf", { type: "application/pdf" });
  const large = new File([new Uint8Array(4 * 1024 * 1024 + 1)], "grande.pdf", {
    type: "application/pdf",
  });
  fireEvent.drop(screen.getByText("Arraste os documentos para cá").parentElement!.parentElement!, {
    dataTransfer: { files: [file, large] },
  });
  await waitFor(() => expect(state.transfer).toHaveBeenCalledTimes(1));
  expect(screen.getByRole("alert")).toHaveTextContent("até 4 MB");
  expect((state.transfer.mock.calls[0]![1] as FormData).get("categories")).toBe('["OTHER"]');
});
it("preserves an interrupted upload operation across closing and reopening the document panel", async () => {
  setup();
  const ref = createRef<PatientDocumentCenterViewState | null>();
  state.transfer.mockImplementationOnce(
    (_url: string, _body: FormData, signal: AbortSignal) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () =>
          reject(new DOMException("Interrompido", "AbortError")),
        ),
      ),
  );
  const first = render(<PatientDocumentCenter patientId="patient" viewState={ref} />);
  fireEvent.change(screen.getByLabelText("Selecionar documentos"), {
    target: {
      files: [new File(["%PDF-1.7 synthetic"], "interrompido.pdf", { type: "application/pdf" })],
    },
  });
  await waitFor(() => expect(state.transfer).toHaveBeenCalledTimes(1));
  const op = (state.transfer.mock.calls[0]![1] as FormData).get("id");
  first.unmount();
  render(<PatientDocumentCenter patientId="patient" viewState={ref} />);
  expect(screen.getByText("Envio interrompido")).toBeInTheDocument();
  expect(state.transfer).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
  await waitFor(() => expect(state.transfer).toHaveBeenCalledTimes(2));
  expect((state.transfer.mock.calls[1]![1] as FormData).get("id")).toBe(op);
});

it("offers the existing duplicate and only repeats with an explicit reason and a new operation", async () => {
  setup();
  state.transfer.mockRejectedValueOnce(
    new DocumentTransferError("Arquivo já recebido", "existing", "DUPLICATE_DOCUMENT"),
  );
  render(<PatientDocumentCenter patientId="patient" />);
  fireEvent.change(screen.getByLabelText("Selecionar documentos"), {
    target: {
      files: [new File(["%PDF-1.7 synthetic"], "duplicado.pdf", { type: "application/pdf" })],
    },
  });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Abrir existente" })).toBeInTheDocument(),
  );
  expect(state.transfer).toHaveBeenCalledTimes(1);
  const op = (state.transfer.mock.calls[0]![1] as FormData).get("id");
  fireEvent.click(screen.getByText("Registrar repetição intencional"));
  expect(screen.getByRole("button", { name: "Confirmar repetição justificada" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Justificativa para duplicado.pdf"), {
    target: { value: "Repetição sintética autorizada" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Confirmar repetição justificada" }));
  await waitFor(() => expect(state.transfer).toHaveBeenCalledTimes(2));
  const body = state.transfer.mock.calls[1]![1] as FormData;
  expect(body.get("id")).not.toBe(op);
  expect(body.get("duplicateOf")).toBe("existing");
  expect(body.get("duplicateReason")).toBe("Repetição sintética autorizada");
});
