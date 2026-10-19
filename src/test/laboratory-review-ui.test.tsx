import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LaboratoryReview } from "@/components/clinic/laboratory-review";
import { emptyLaboratoryDraft } from "@/lib/laboratory-results";
vi.mock("@/components/clinic/private-document-preview", () => ({
  PrivateDocumentPreview: () => <div>PDF original preservado</div>,
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("reviews beside the original, saves before validation and preserves literal results", async () => {
  let current = {
    source: {
      id: "doc",
      title: "Exame sintético",
      sha256: "hash",
      previewUrl: "/api/v1/inventory/patient-document-file?sourceId=doc",
    },
    import: {
      id: "job",
      status: "WAITING",
      version: 0,
      draft: emptyLaboratoryDraft(),
      processing_started_at: null,
      failure_code: null,
    },
    versions: [] as { id: string; version: number; reviewer_name: string; created_at: string }[],
    events: [],
    extractionAvailable: false,
    extractionMessage: "Extração por IA ainda não configurada.",
  };
  const actions: {
    action: string;
    draft?: import("@/lib/laboratory-results").LaboratoryDraft;
    version?: number;
    operationId?: string;
  }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init: RequestInit) => {
      const body = init.body ? JSON.parse(String(init.body)) : null;
      if (body) {
        actions.push(body);
        if (body.action === "SAVE")
          current = {
            ...current,
            import: { ...current.import, draft: body.draft, status: "READY_REVIEW", version: 1 },
          };
        if (body.action === "VALIDATE")
          current = {
            ...current,
            import: { ...current.import, status: "VALIDATED", version: 2 },
            versions: [
              {
                id: "version",
                version: 1,
                reviewer_name: "Profissional",
                created_at: "2026-10-19T12:00:00Z",
              },
            ],
          };
      }
      return Response.json({ data: current });
    }),
  );
  render(<LaboratoryReview patientId="patient" documentId="doc" />);
  fireEvent.click(screen.getByRole("button", { name: "Conferir resultados laboratoriais" }));
  await screen.findByText("PDF original preservado");
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Adicionar resultado" })).toBeEnabled(),
  );
  expect(screen.getByRole("button", { name: "Confirmar resultados" })).toBeDisabled();
  expect(
    screen.queryByRole("button", { name: "Extrair resultados com IA" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Adicionar resultado" }));
  fireEvent.change(screen.getByLabelText("Exame da linha 1"), { target: { value: "TSH" } });
  fireEvent.change(screen.getByLabelText("Resultado da linha 1"), { target: { value: "<0,1" } });
  fireEvent.click(screen.getByLabelText("Conferir linha 1"));
  fireEvent.click(
    screen.getByLabelText("Confirmei que o PDF corresponde ao paciente selecionado."),
  );
  fireEvent.click(screen.getByRole("button", { name: "Confirmar resultados" }));
  await waitFor(() => expect(screen.getByText("Validado")).toBeInTheDocument());
  expect(actions.map((a) => a.action)).toEqual(["OPEN", "SAVE", "VALIDATE"]);
  expect(actions[1]?.draft?.rows[0]?.result).toBe("<0,1");
  expect(actions[2]?.version).toBe(1);
  expect(actions[2]?.operationId).toMatch(/^[a-f0-9-]{36}$/);
  expect(screen.getByLabelText("Resultado da linha 1")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Corrigir resultados" })).toBeInTheDocument();
});
