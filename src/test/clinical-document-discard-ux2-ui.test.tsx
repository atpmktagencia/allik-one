import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
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

type DocumentOverrides = Partial<{
  id: string;
  title: string;
  content: string;
  status: "DRAFT" | "FINAL" | "DISCARDED";
  version: number;
  canEdit: boolean;
  canDiscard: boolean;
}>;

function requestDocument(overrides: DocumentOverrides = {}) {
  return {
    id: "exam-draft",
    type: "EXAM_REQUEST",
    title: "Solicitação de exames sintética",
    content: "Hemograma completo",
    richContent: null,
    twoCopies: false,
    status: "DRAFT" as const,
    version: 3,
    authorName: "Profissional sintético",
    professionalCouncil: "CRM",
    councilNumber: "123",
    councilRegion: "CE",
    canEdit: true,
    canDiscard: true,
    ...overrides,
  };
}

function renderRequests(documents: Array<ReturnType<typeof requestDocument>>, failDiscard = false) {
  let current = [...documents];
  const calls: Array<{ method: string; body?: Record<string, unknown> }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "POST") {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        calls.push({ method, body });
        if (failDiscard) throw new TypeError("Falha de rede ao excluir o rascunho");
        current = current.filter((item) => item.id !== body["documentId"]);
        return Response.json({
          data: {
            id: body["documentId"],
            status: "DISCARDED",
            version: Number(body["version"]) + 1,
          },
        });
      }
      calls.push({ method });
      return Response.json({
        data: {
          documents: current.map((item) => ({ ...item })),
          templates: [],
          canAuthor: true,
          allowedDocumentTypes: ["EXAM_REQUEST"],
          context: {
            patientName: "Paciente sintético",
            birthDate: null,
            unitName: "Unidade sintética",
            allergies: null,
          },
        },
      });
    }),
  );
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <EncounterDocumentsCard appointmentId="appointment-discard" mode="requests" />
    </QueryClientProvider>,
  );
  return calls;
}

describe("Clinical document discard UX", () => {
  it("shows delete only for an editable discardable draft and makes no write while entering Solicitações", async () => {
    const calls = renderRequests([
      requestDocument(),
      requestDocument({
        id: "draft-without-discard",
        title: "Rascunho sem permissão de descarte",
        canDiscard: false,
      }),
      requestDocument({
        id: "final-document",
        title: "Solicitação finalizada",
        status: "FINAL",
        canEdit: false,
        canDiscard: true,
      }),
    ]);

    const table = await screen.findByRole("table");
    expect(within(table).getByText("Solicitação de exames sintética")).toBeInTheDocument();
    expect(within(table).getAllByRole("button", { name: "Excluir rascunho" })).toHaveLength(1);
    expect(within(table).getByText("Solicitação finalizada")).toBeInTheDocument();
    expect(calls.some((call) => call.method === "POST" || call.method === "DELETE")).toBe(false);
  });

  it("requires a reason and confirms DISCARD with the current version before refetching away the draft", async () => {
    const draft = requestDocument({ version: 7 });
    const calls = renderRequests([draft]);

    fireEvent.click(
      within(await screen.findByRole("table")).getByRole("button", { name: "Excluir rascunho" }),
    );
    const dialog = await screen.findByRole("dialog");
    const reason = screen.getByRole("textbox", { name: "Motivo do descarte" });
    const confirm = within(dialog).getByRole("button", { name: "Excluir rascunho" });
    expect(dialog).toHaveTextContent("Excluir rascunho?");

    fireEvent.change(reason, { target: { value: "   " } });
    expect(confirm).toBeDisabled();
    fireEvent.change(reason, { target: { value: "Solicitação duplicada revisada" } });
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);

    expect(
      await screen.findByText("Rascunho excluído. O histórico de auditoria foi preservado."),
    ).toBeInTheDocument();
    expect(screen.queryByText(draft.title)).not.toBeInTheDocument();
    expect(calls).toContainEqual({
      method: "POST",
      body: {
        action: "DISCARD",
        appointmentId: "appointment-discard",
        documentId: draft.id,
        type: "EXAM_REQUEST",
        version: 7,
        reason: "Solicitação duplicada revisada",
      },
    });
    expect(calls.some((call) => call.method === "DELETE")).toBe(false);
  });

  it("keeps the draft visible and exposes the network error when discard fails", async () => {
    const draft = requestDocument({ id: "network-draft" });
    renderRequests([draft], true);

    fireEvent.click(
      within(await screen.findByRole("table")).getByRole("button", { name: "Excluir rascunho" }),
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Motivo do descarte" }), {
      target: { value: "Falha de conexão confirmada" },
    });
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Excluir rascunho" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Falha de rede ao excluir o rascunho",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancelar" }));
    expect(within(screen.getByRole("table")).getByText(draft.title)).toBeInTheDocument();
  });
});
