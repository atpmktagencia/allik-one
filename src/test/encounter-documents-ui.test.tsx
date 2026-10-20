import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Editor } from "@tiptap/react";
import { EncounterDocumentsCard } from "@/components/clinic/encounter-documents-card";

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
const draft = (id: string, type = "PRESCRIPTION", extra: Record<string, unknown> = {}) => ({
  id,
  type,
  title: "RECEITA MÉDICA",
  content: "Orientação inicial",
  richContent: null,
  twoCopies: false,
  version: 1,
  status: "DRAFT",
  authorName: "Profissional",
  canEdit: true,
  ...extra,
});
function renderCard(
  documents: Array<Record<string, unknown>> = [],
  templates: Array<Record<string, unknown>> = [],
  mode: "all" | "prescription" | "requests" = "all",
) {
  const writes: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        writes.push(body);
        const existing = documents.find((item) => item["id"] === body.documentId);
        if (body.action === "DISCARD_DRAFT" && existing) {
          documents.splice(documents.indexOf(existing), 1);
          return Response.json({
            data: { id: existing["id"], version: Number(existing["version"]) + 1 },
          });
        }
        const saved = {
          ...existing,
          ...body,
          id: existing?.["id"] ?? `new-${writes.length}`,
          version: Number(existing?.["version"] ?? 0) + 1,
          status: body.action === "FINALIZE" ? "FINAL" : "DRAFT",
          canEdit: body.action !== "FINALIZE",
          authorName: "Profissional",
        };
        if (body.action === "SAVE_TEMPLATE") templates.push(saved);
        else if (existing) Object.assign(existing, saved);
        else documents.push(saved);
        return Response.json({ data: { id: saved.id, version: saved.version } });
      }
      if (String(_url).includes("prescription-composer"))
        return Response.json({ data: { templates: [], canCompose: true } });
      return Response.json({
        data: {
          documents: documents.map((item) => ({ ...item })),
          templates: [...templates],
          canAuthor: true,
          context: {
            patientName: "Paciente sintético",
            birthDate: "1991-01-01",
            unitName: "Fortaleza",
            allergies: null,
            prescriptionPrintData: {
              kind: "SIMPLE",
              patientDocument: "Documento sintético",
              patientAddress: "Rua de teste, 10",
              patientAge: 35,
              patientSex: "",
              issuerAddress: "",
              issuerPhone: "",
              issuerCity: "",
              issuerState: "",
            },
          },
        },
      });
    }),
  );
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <EncounterDocumentsCard appointmentId="appointment-1" mode={mode} />
    </QueryClientProvider>,
  );
  return writes;
}
async function editor() {
  const element = await screen.findByRole("textbox", { name: "Conteúdo do documento" });
  return (element as HTMLElement & { editor: Editor }).editor;
}
async function type(content: string) {
  const instance = await editor();
  act(() => {
    instance.commands.insertContent(content);
  });
}
function menu(name: string) {
  fireEvent.keyDown(screen.getByRole("button", { name }), { key: "Enter" });
}

describe("Encounter documents workspace", () => {
  it("keeps print in the toolbar and expands without losing draft text", async () => {
    renderCard([draft("rx")]);
    await type(" texto preservado");
    expect(screen.queryByText(/Prescrever com Mevo/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Visualizar impressão" })).toHaveLength(1);
    menu("Opções do documento");
    await screen.findByRole("menuitem", { name: "Dados da receita" });
    expect(
      screen.queryByRole("menuitem", { name: "Visualizar impressão" }),
    ).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    fireEvent.click(await screen.findByRole("button", { name: "Expandir editor" }));
    expect(screen.getByRole("button", { name: "Recolher editor" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("button", { name: "Expandir editor" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("textbox", { name: "Conteúdo do documento" })).toHaveTextContent(
      "texto preservado",
    );
  });

  it("saves prescription metadata and selects two copies for special control", async () => {
    const writes = renderCard([draft("rx")]);
    await editor();
    menu("Opções do documento");
    fireEvent.click(await screen.findByRole("menuitem", { name: "Dados da receita" }));
    fireEvent.change(screen.getByLabelText("Tipo de receituário"), {
      target: { value: "SPECIAL_CONTROL" },
    });
    fireEvent.change(screen.getByLabelText("Endereço profissional"), {
      target: { value: "Rua Clínica, 10" },
    });
    fireEvent.change(screen.getByLabelText("Documento do paciente"), {
      target: { value: "Documento sintético" },
    });
    fireEvent.change(screen.getByLabelText("Idade do paciente"), { target: { value: "35" } });
    fireEvent.click(screen.getByRole("button", { name: "Concluir" }));
    expect(screen.getByRole("checkbox", { name: /duas vias/ })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    await screen.findByText("Rascunho salvo.");
    expect(writes[0]).toMatchObject({
      twoCopies: true,
      prescriptionPrintData: {
        kind: "SPECIAL_CONTROL",
        issuerAddress: "Rua Clínica, 10",
        patientDocument: "Documento sintético",
        patientAge: 35,
      },
    });
  });

  it("creates a separately persisted typed draft with automatic title", async () => {
    const writes = renderCard();
    await screen.findByRole("button", { name: "Novo documento" });
    menu("Novo documento");
    fireEvent.click(await screen.findByRole("menuitem", { name: "Solicitação de exames" }));
    const tab = await screen.findByRole("tab", { name: /Exames 1/ });
    expect(tab).toHaveAttribute("aria-selected", "true");
    expect(writes[0]).toMatchObject({
      action: "SAVE_DRAFT",
      documentId: null,
      type: "EXAM_REQUEST",
      title: "SOLICITAÇÃO DE EXAMES",
      content: "",
    });
    expect(screen.getByRole("heading", { name: "SOLICITAÇÃO DE EXAMES" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /duas vias/ })).not.toBeInTheDocument();
    await type("Hemograma completo");
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    await screen.findByText("Rascunho salvo.");
    expect(writes[1]).toMatchObject({
      type: "EXAM_REQUEST",
      content: "Hemograma completo",
      documentId: "new-1",
      prescriptionPrintData: null,
    });
    expect(writes[1]!["richContent"]).toMatchObject({ type: "doc" });
  });

  it("preserves unsaved formatted text and two-copy choice independently across tabs", async () => {
    const writes = renderCard([draft("rx"), draft("exams", "EXAM_REQUEST")]);
    const instance = await editor();
    act(() => {
      instance.commands.setContent("<p><strong>Prescrição preservada</strong></p>", {
        emitUpdate: true,
      });
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /Emitir receita em duas vias/ }));
    fireEvent.click(screen.getByRole("tab", { name: /Exames 1/ }));
    expect(await screen.findByRole("textbox", { name: "Conteúdo do documento" })).toHaveTextContent(
      "Orientação inicial",
    );
    await type(" exame adicional");
    fireEvent.click(screen.getByRole("tab", { name: /Receita 1/ }));
    const returned = await screen.findByRole("textbox", { name: "Conteúdo do documento" });
    expect(returned).toHaveTextContent("Prescrição preservada");
    expect(returned.querySelector("strong")).toHaveTextContent("Prescrição preservada");
    expect(screen.getByRole("checkbox", { name: /duas vias/ })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    await screen.findByText("Rascunho salvo.");
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      documentId: "rx",
      twoCopies: true,
      content: "Prescrição preservada",
    });
    fireEvent.click(screen.getByRole("tab", { name: /Exames 1/ }));
    expect(await screen.findByRole("textbox", { name: "Conteúdo do documento" })).toHaveTextContent(
      "exame adicional",
    );
  });

  it("keeps another author's drafts and finalized documents read-only", async () => {
    renderCard([
      draft("other", "PRESCRIPTION", { canEdit: false }),
      draft("final", "EXAM_REQUEST", { status: "FINAL", canEdit: false }),
    ]);
    expect(await screen.findByRole("textbox", { name: "Conteúdo do documento" })).toHaveAttribute(
      "contenteditable",
      "false",
    );
    expect(screen.queryByRole("button", { name: "Salvar rascunho" })).not.toBeInTheDocument();
    expect(screen.getByText(/Somente seu autor pode alterá-lo/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /Exames 1 Finalizado/ }));
    expect(await screen.findByRole("textbox", { name: "Conteúdo do documento" })).toHaveAttribute(
      "contenteditable",
      "false",
    );
    expect(screen.queryByRole("button", { name: "Finalizar documento" })).not.toBeInTheDocument();
    expect(screen.getByText(/conteúdo imutável/)).toBeInTheDocument();
  });

  it("requires confirmation before a model replaces existing text", async () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    renderCard(
      [draft("rx")],
      [{ id: "model", type: "PRESCRIPTION", title: "Modelo de teste", content: "Texto do modelo" }],
    );
    await editor();
    menu("Modelos");
    fireEvent.click(await screen.findByRole("menuitem", { name: "Modelo de teste" }));
    fireEvent.click(await screen.findByRole("button", { name: "Substituir conteúdo" }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(
      screen.getByRole("textbox", { name: "Conteúdo do documento", hidden: true }),
    ).toHaveTextContent("Orientação inicial");
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Substituir conteúdo" }));
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Conteúdo do documento" })).toHaveTextContent(
        "Texto do modelo",
      ),
    );
  });

  it("saves formatted personal models and finalizes only after confirmation", async () => {
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
    const writes = renderCard([draft("rx")]);
    const instance = await editor();
    act(() => {
      instance.commands.setContent("<p><em>Instrução sintética</em></p>", { emitUpdate: true });
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar como modelo" }));
    fireEvent.change(await screen.findByRole("textbox", { name: "Nome do modelo" }), {
      target: { value: "Modelo pessoal" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar modelo" }));
    await screen.findByText("Modelo salvo para seus próximos atendimentos.");
    expect(writes[0]).toMatchObject({
      action: "SAVE_TEMPLATE",
      title: "Modelo pessoal",
      content: "Instrução sintética",
    });
    expect(writes[0]!["richContent"]).toMatchObject({ type: "doc" });
    fireEvent.click(screen.getByRole("button", { name: "Finalizar documento" }));
    await screen.findByText("Documento finalizado.");
    expect(writes[1]).toMatchObject({ action: "FINALIZE", documentId: "rx" });
    expect(screen.getByRole("textbox", { name: "Conteúdo do documento" })).toHaveAttribute(
      "contenteditable",
      "false",
    );
    expect(screen.getByText(/Finalização não equivale a assinatura/)).toBeInTheDocument();
  });

  it("saves pending changes before opening the authorized draft print preview", async () => {
    const preview = { opener: {}, location: { href: "about:blank" }, close: vi.fn() };
    const open = vi.fn(() => preview);
    vi.stubGlobal("open", open);
    const writes = renderCard([draft("rx")]);
    await type(" orientação adicional");
    fireEvent.click(screen.getByRole("checkbox", { name: /duas vias/ }));
    fireEvent.click(screen.getByRole("button", { name: "Visualizar impressão" }));
    await waitFor(() =>
      expect(preview.location.href).toBe(
        "/api/v1/inventory/encounter-documents?documentId=rx&print=true&preview=true",
      ),
    );
    expect(writes[0]).toMatchObject({ action: "SAVE_DRAFT", twoCopies: true });
    expect(preview.opener).toBeNull();
    expect(open).toHaveBeenCalledOnce();
  });
});

it("opens the complete composer by default without creating a document, preserving local components across the legacy editor", async () => {
  const writes = renderCard([], [], "prescription");
  const name = await screen.findByLabelText("Nome do componente");
  fireEvent.change(name, { target: { value: "Componente sintético local" } });
  expect(writes).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Receitas e histórico" }));
  expect(name).not.toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Compor prescrição" }));
  expect(name).toBeVisible();
  expect(name).toHaveValue("Componente sintético local");
  expect(writes).toHaveLength(0);
});

it("requires confirmation before excluding a request draft and updates the list immediately after acknowledgement", async () => {
  const document = draft("request", "EXAM_REQUEST", { title: "Solicitação sintética" });
  const writes = renderCard([document], [], "requests");
  const confirm = vi.fn(() => false);
  vi.stubGlobal("confirm", confirm);
  const discard = await screen.findByRole("button", {
    name: "Excluir rascunho: Solicitação sintética",
  });
  fireEvent.click(discard);
  expect(writes).toHaveLength(0);
  confirm.mockReturnValue(true);
  fireEvent.click(discard);
  await waitFor(() =>
    expect(writes[0]).toMatchObject({
      action: "DISCARD_DRAFT",
      documentId: "request",
      version: 1,
      type: "EXAM_REQUEST",
    }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Excluir rascunho: Solicitação sintética" }),
    ).not.toBeInTheDocument(),
  );
  expect(await screen.findByRole("status")).toHaveTextContent("Histórico preservado");
});

it("does not offer ordinary deletion or duplication for finalized requests", async () => {
  const document = draft("request", "EXAM_REQUEST", {
    title: "Solicitação final",
    status: "FINAL",
    canEdit: false,
  });
  const writes = renderCard([document], [], "requests");
  await screen.findByRole("button", { name: "Visualizar" });
  expect(screen.queryByRole("button", { name: /Excluir rascunho/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Duplicar rascunho/ })).not.toBeInTheDocument();
  expect(writes).toHaveLength(0);
});

it("duplicates a request into an independent draft without changing its source", async () => {
  const source = draft("request-source", "EXAM_REQUEST", { title: "Solicitação de origem" });
  const writes = renderCard([source], [], "requests");
  fireEvent.click(
    await screen.findByRole("button", { name: "Duplicar rascunho: Solicitação de origem" }),
  );
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]).toMatchObject({
    action: "SAVE_DRAFT",
    type: "EXAM_REQUEST",
    content: "Orientação inicial",
  });
  expect(writes[0]!["documentId"]).not.toBe("request-source");
  expect(writes[0]!["version"]).toBeNull();
  expect(source).toMatchObject({ id: "request-source", version: 1, content: "Orientação inicial" });
});
