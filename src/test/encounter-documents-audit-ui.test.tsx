import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Editor } from "@tiptap/react";
import { PatientClinicalPlans } from "@/components/clinic/patient-clinical-plans";
import { EncounterDocumentsCard } from "@/components/clinic/encounter-documents-card";
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useBlocker: vi.fn(),
}));
vi.mock("@/components/clinic/prescription-composer", () => ({
  PrescriptionComposer: ({
    onDraftStateChange,
  }: {
    onDraftStateChange?: (s: { dirty: boolean; pending: boolean }) => void;
  }) => (
    <button onClick={() => onDraftStateChange?.({ dirty: true, pending: false })}>
      Modificar composição sintética
    </button>
  ),
}));
beforeAll(() => {
  Object.defineProperty(Range.prototype, "getClientRects", { value: () => [], configurable: true });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    value: () => new DOMRect(),
    configurable: true,
  });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    value: () => {},
    configurable: true,
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function mount(mode: "prescription" | "requests", status = "DRAFT") {
  const state = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        data: {
          documents: [
            {
              id: "rx",
              type: "PRESCRIPTION",
              title: "RECEITA MÉDICA",
              content: "Texto final preservado",
              status,
              version: 1,
              authorName: "Autor preservado",
              professionalCouncil: "CRM",
              councilNumber: "123",
              councilRegion: "CE",
              canEdit: status === "DRAFT",
              finalPreview:
                status === "FINAL"
                  ? {
                      patientName: "Nome congelado",
                      title: "Receita congelada",
                      content: "Texto final preservado",
                    }
                  : null,
            },
          ],
          templates: [],
          canAuthor: true,
          allowedDocumentTypes: [
            "PRESCRIPTION",
            "EXAM_REQUEST",
            "REFERRAL",
            "MEDICAL_CERTIFICATE",
            "MEDICAL_REPORT",
            "INSTRUCTIONS",
          ],
          context: {
            patientName: "Nome atual alterado",
            birthDate: null,
            unitName: "Unidade teste",
            allergies: null,
          },
        },
      }),
    ),
  );
  const query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={query}>
      <EncounterDocumentsCard appointmentId="appointment" mode={mode} onDraftStateChange={state} />
    </QueryClientProvider>,
  );
  return state;
}
describe("Document audit safeguards", () => {
  it("preserves the real procedure plan draft and fixed encounter binding across request categories and prescription navigation", async () => {
    const appointmentId = "11111111-1111-4111-8111-111111111111";
    const planState = vi.fn();
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") throw new Error("Navigation must not save the clinical plan");
      return Response.json({
        data: url.includes("patient-treatment-plans")
          ? {
              plans: [],
              canManage: true,
              targets: {
                products: [],
                catalogItems: [],
                treatments: [],
                appointments: [],
                prescriptionInstances: [],
              },
            }
          : {
              documents: [],
              templates: [],
              canAuthor: true,
              allowedDocumentTypes: ["PRESCRIPTION", "EXAM_REQUEST", "REFERRAL"],
            },
      });
    });
    vi.stubGlobal("fetch", fetch);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const procedures = (
      <PatientClinicalPlans
        patientId="patient"
        appointmentId={appointmentId}
        onDraftStateChange={planState}
      />
    );
    const workspace = (mode: "prescription" | "requests") => (
      <QueryClientProvider client={client}>
        <EncounterDocumentsCard appointmentId={appointmentId} mode={mode} procedures={procedures} />
      </QueryClientProvider>
    );
    const view = render(workspace("requests"));
    fireEvent.click(await screen.findByRole("button", { name: "Procedimentos" }));
    fireEvent.click(await screen.findByRole("button", { name: "Novo plano de procedimentos" }));
    fireEvent.change(screen.getByLabelText("Nome do plano clínico"), {
      target: { value: "Plano de procedimentos não salvo" },
    });
    fireEvent.change(screen.getByLabelText("Nome do item clínico"), {
      target: { value: "Procedimento em elaboração" },
    });
    await waitFor(() =>
      expect(planState).toHaveBeenLastCalledWith({ dirty: true, pending: false }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Exames laboratoriais" }));
    expect(screen.getByLabelText("Nome do plano clínico")).not.toBeVisible();
    expect(planState).toHaveBeenLastCalledWith({ dirty: true, pending: false });
    view.rerender(workspace("prescription"));
    await screen.findByRole("button", { name: "Medicamentos" });
    expect(screen.getByLabelText("Nome do plano clínico")).not.toBeVisible();
    expect(planState).toHaveBeenLastCalledWith({ dirty: true, pending: false });
    view.rerender(workspace("requests"));
    fireEvent.click(await screen.findByRole("button", { name: "Procedimentos" }));
    expect(screen.getByLabelText("Nome do plano clínico")).toBeVisible();
    expect(screen.getByLabelText("Nome do plano clínico")).toHaveValue(
      "Plano de procedimentos não salvo",
    );
    expect(screen.getByLabelText("Nome do item clínico")).toHaveValue("Procedimento em elaboração");
    expect(screen.getByLabelText("Atendimento vinculado (fixo)")).toHaveValue(appointmentId);
    expect(screen.getByLabelText("Atendimento vinculado (fixo)")).toBeDisabled();
    expect(planState).toHaveBeenLastCalledWith({ dirty: true, pending: false });
    expect(fetch.mock.calls.some((call) => call[1]?.method === "POST")).toBe(false);
  });

  it("reconciles a lost save acknowledgement without resending or discarding text", async () => {
    let persisted: Record<string, unknown> = {
      id: "rx",
      type: "PRESCRIPTION",
      title: "RECEITA MÉDICA",
      content: "Texto inicial",
      richContent: null,
      twoCopies: false,
      prescriptionPrintData: null,
      status: "DRAFT",
      version: 1,
      authorName: "Autor",
      canEdit: true,
    };
    let posts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          const body = JSON.parse(String(init.body));
          persisted = { ...persisted, ...body, version: 2 };
          posts++;
          throw new TypeError("Lost acknowledgement after synthetic commit");
        }
        return Response.json({ data: { documents: [persisted], templates: [], canAuthor: true } });
      }),
    );
    const state = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <EncounterDocumentsCard appointmentId="appointment" onDraftStateChange={state} />
      </QueryClientProvider>,
    );
    const textbox = await screen.findByRole("textbox", { name: "Conteúdo do documento" });
    act(() => {
      (textbox as HTMLElement & { editor: Editor }).editor.commands.setContent(
        "<p>Texto salvo com confirmação perdida</p>",
        { emitUpdate: true },
      );
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    expect(
      await screen.findByText(
        "Salvamento confirmado após reconferir o servidor. O conteúdo foi preservado.",
      ),
    ).toBeInTheDocument();
    expect(posts).toBe(1);
    expect(screen.getByRole("textbox", { name: "Conteúdo do documento" })).toHaveTextContent(
      "Texto salvo com confirmação perdida",
    );
    await waitFor(() => expect(state).toHaveBeenLastCalledWith({ dirty: false, pending: false }));
  });

  it("uses only the frozen patient identity in the final lateral preview", async () => {
    mount("prescription", "FINAL");
    fireEvent.click(await screen.findByRole("button", { name: "Documentos e assinatura" }));
    const panel = await screen.findByRole("complementary", { name: "Prévia da prescrição" });
    expect(within(panel).getByText("Nome congelado")).toBeInTheDocument();
    expect(within(panel).queryByText("Nome atual alterado")).not.toBeInTheDocument();
  });
  it("offers direct creation only for the active request category", async () => {
    mount("requests");
    expect(await screen.findByRole("button", { name: "Solicitar exame" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Novo documento" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Novo encaminhamento" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Encaminhamentos" }));
    expect(await screen.findByRole("button", { name: "Novo encaminhamento" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Solicitar exame" })).not.toBeInTheDocument();
  });
  it("propagates composer dirty state and requires confirmation before discarding it", async () => {
    const state = mount("prescription");
    fireEvent.click(await screen.findByRole("button", { name: "Documentos e assinatura" }));
    fireEvent.click(await screen.findByRole("button", { name: "Compor receita estruturada" }));
    fireEvent.click(await screen.findByRole("button", { name: "Modificar composição sintética" }));
    await waitFor(() => expect(state).toHaveBeenLastCalledWith({ dirty: true, pending: false }));
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(confirm).toHaveBeenCalledOnce();
    expect(
      screen.getByRole("button", { name: "Modificar composição sintética" }),
    ).toBeInTheDocument();
    confirm.mockReturnValue(true);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(state).toHaveBeenLastCalledWith({ dirty: false, pending: false }));
  });
  it("keeps an inline dirty composition guarded after closing a separate legacy composer", async () => {
    const state = mount("prescription");
    fireEvent.click(await screen.findByRole("button", { name: "Modificar composição sintética" }));
    await waitFor(() => expect(state).toHaveBeenLastCalledWith({ dirty: true, pending: false }));
    fireEvent.click(screen.getByRole("button", { name: "Documentos e assinatura" }));
    fireEvent.click(await screen.findByRole("button", { name: "Compor receita estruturada" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Modificar composição sintética" }));
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(state).toHaveBeenLastCalledWith({ dirty: true, pending: false });
    fireEvent.click(screen.getByRole("button", { name: "Voltar ao compositor" }));
    expect(screen.getByRole("button", { name: "Modificar composição sintética" })).toBeVisible();
  });
});
