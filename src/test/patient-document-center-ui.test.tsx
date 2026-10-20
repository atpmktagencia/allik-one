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
}));
vi.mock("@/data/inventory-api", async (original) => ({
  ...(await original<typeof import("@/data/inventory-api")>()),
  useInventory: (resource: string) => {
    state.resources.push(resource);
    return { data: state.data, isPending: false, error: null, refetch: state.refetch };
  },
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
  it("uploads original with multiple categories and reuses operation ID after ambiguous failure", async () => {
    setup();
    const NativeFormData = FormData;
    vi.stubGlobal(
      "FormData",
      class extends NativeFormData {
        constructor(form?: HTMLFormElement) {
          super(form);
          if (form) {
            const input = form.elements.namedItem("file") as HTMLInputElement;
            const file = input.files?.[0];
            if (file) this.set("file", file);
          }
        }
      },
    );
    const bodies: FormData[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init: RequestInit) => {
        bodies.push(init.body as FormData);
        if (bodies.length === 1) throw new Error("Falha de rede");
        return Response.json({ data: { id: "uploaded" } });
      }),
    );
    render(<PatientDocumentCenter patientId="patient" />);
    fireEvent.click(screen.getByRole("button", { name: "Anexar arquivo" }));
    fireEvent.change(screen.getByLabelText("Nome do documento"), {
      target: { value: "Laudo sintético" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Solicitação de exames" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Resultado laboratorial" }));
    const oversized = new File([new Uint8Array(4 * 1024 * 1024 + 1)], "large.pdf", {
      type: "application/pdf",
    });
    fireEvent.change(screen.getByLabelText("Arquivo original"), { target: { files: [oversized] } });
    fireEvent.submit(screen.getByRole("form", { name: "Anexar documento do paciente" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("até 4 MB"));
    expect(fetch).not.toHaveBeenCalled();
    const file = new File(["%PDF-1.7 synthetic"], "laudo.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText("Arquivo original"), { target: { files: [file] } });
    fireEvent.submit(screen.getByRole("form", { name: "Anexar documento do paciente" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Falha de rede"));
    fireEvent.submit(screen.getByRole("form", { name: "Anexar documento do paciente" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Original armazenado"),
    );
    expect(bodies[0]!.get("categories")).toBe(JSON.stringify(["EXAM_REQUEST", "LAB_RESULT"]));
    expect(bodies[0]!.get("id")).toBe(bodies[1]!.get("id"));
    expect(bodies[0]!.get("patientId")).toBe("patient");
    expect(bodies[0]!.get("file")).toBe(file);
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
it("defaults exam imports to laboratory results and never offers unrelated categories", () => {
  setup({
    categories: [
      { id: "LAB_RESULT", name: "Resultado laboratorial", builtin: true },
      { id: "IMAGE_REPORT", name: "Laudo de imagem", builtin: true },
      { id: "OTHER", name: "Outro", builtin: true },
    ],
  });
  render(<PatientDocumentCenter patientId="patient" unitId="unit-a" examsOnly />);
  fireEvent.click(screen.getByRole("button", { name: "Anexar arquivo" }));
  expect(screen.getByRole("checkbox", { name: "Resultado laboratorial" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Laudo de imagem" })).not.toBeChecked();
  expect(screen.queryByRole("checkbox", { name: "Outro" })).not.toBeInTheDocument();
  expect(state.resources.at(-1)).toContain("unitId=unit-a");
});
