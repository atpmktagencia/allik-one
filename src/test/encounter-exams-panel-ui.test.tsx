import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EncounterExamsPanel } from "@/components/clinic/encounter-exams-panel";

const state = vi.hoisted(() => ({ files: {} as Record<string, unknown>, resource: "" }));
vi.mock("@/data/inventory-api", () => ({
  useInventory: (resource: string) => {
    state.resource = resource;
    return { data: state.files, isPending: false, error: null, refetch: vi.fn() };
  },
}));
vi.mock("@/components/clinic/laboratory-history", () => ({
  LaboratoryHistory: () => <p>Nenhum resultado confirmado ainda.</p>,
}));
vi.mock("@/components/clinic/private-document-preview", () => ({
  PrivateDocumentPreview: ({ document }: { document: { title: string } }) => (
    <div>Original privado: {document.title}</div>
  ),
}));
vi.mock("@/components/clinic/laboratory-review", () => ({
  LaboratoryReview: () => <button>Conferir resultados laboratoriais</button>,
}));

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});
function setup(canUpload = true) {
  state.files = {
    total: 7,
    hasMore: true,
    canUpload,
    documents: [
      {
        id: "GENERAL_DOCUMENT:pdf:1",
        sourceId: "pdf",
        sourceKind: "GENERAL_DOCUMENT",
        title: "Exame aguardando conferência.pdf",
        previewUrl: "/api/v1/inventory/patient-document-file?patientId=patient&sourceId=pdf",
        contentType: "application/pdf",
        laboratoryStatus: "READY_REVIEW",
      },
    ],
  };
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <EncounterExamsPanel patientId="patient" unitId="unit" />
    </QueryClientProvider>,
  );
}
it("shows uploaded exams before confirmation and opens the original and review without publishing values", () => {
  setup();
  expect(state.resource).toBe(
    "patient-documents?patientId=patient&categoryGroup=EXAMS&limit=5&unitId=unit",
  );
  const files = screen.getByRole("region", { name: "Arquivos de exames do paciente" });
  expect(within(files).getByText("Pronto para revisão")).toBeInTheDocument();
  expect(screen.getByText("Nenhum resultado confirmado ainda.")).toBeInTheDocument();
  expect(screen.queryByText(/Original privado:/)).not.toBeInTheDocument();
  expect(within(files).getByText(/Exibindo os 1 arquivos mais recentes de 7/)).toBeInTheDocument();
  fireEvent.click(
    within(files).getByRole("button", { name: "Abrir exame: Exame aguardando conferência.pdf" }),
  );
  const original = screen.getByRole("complementary", { name: "Documento original do exame" });
  expect(
    within(original).getByText("Original privado: Exame aguardando conferência.pdf"),
  ).toBeInTheDocument();
  expect(
    within(original).getByRole("button", { name: "Conferir resultados laboratoriais" }),
  ).toBeInTheDocument();
  expect(screen.getByText("Nenhum resultado confirmado ainda.")).toBeInTheDocument();
});

it("does not offer review without clinical access and clears an opened source on patient change", () => {
  const view = setup(false);
  fireEvent.click(
    screen.getByRole("button", { name: "Abrir exame: Exame aguardando conferência.pdf" }),
  );
  expect(
    screen.queryByRole("button", { name: "Conferir resultados laboratoriais" }),
  ).not.toBeInTheDocument();
  view.rerender(
    <QueryClientProvider client={new QueryClient()}>
      <EncounterExamsPanel patientId="other-patient" unitId="unit" />
    </QueryClientProvider>,
  );
  expect(screen.queryByText(/Original privado:/)).not.toBeInTheDocument();
});
