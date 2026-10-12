import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EncounterDocumentsCard } from "@/components/clinic/encounter-documents-card";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderCard(documents: Array<Record<string, unknown>> = []) {
  const writes: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        writes.push(body);
        documents.push({
          ...body,
          id: "saved-document",
          version: 1,
          status: "DRAFT",
          authorName: "Profissional",
        });
        return Response.json({ data: { id: "saved-document", version: 1 } });
      }
      return Response.json({ data: { documents, templates: [], canAuthor: true } });
    }),
  );
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <EncounterDocumentsCard appointmentId="appointment-1" />
    </QueryClientProvider>,
  );
  return writes;
}

describe("Encounter document editor", () => {
  it("shows another author's draft as read-only while permitting a new document", async () => {
    renderCard([
      {
        id: "other-draft",
        title: "Receita anterior",
        content: "Conteúdo anterior",
        type: "PRESCRIPTION",
        status: "DRAFT",
        version: 1,
        authorName: "Outro profissional",
        canEdit: false,
      },
    ]);
    fireEvent.click(await screen.findByRole("button", { name: /Documento 1/ }));
    expect(screen.getByRole("textbox", { name: "Prescrição" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Salvar rascunho" })).not.toBeInTheDocument();
    expect(screen.getByText(/Somente seu autor pode alterá-lo/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Nova prescrição" }));
    expect(screen.getByRole("textbox", { name: "Prescrição" })).not.toBeDisabled();
  });
  it("saves a separate exam request and reopens its persisted version", async () => {
    const writes = renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Solicitar exames" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Solicitação de exames" }), {
      target: { value: "Hemograma completo" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    await screen.findByText("Rascunho salvo.");
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      action: "SAVE_DRAFT",
      type: "EXAM_REQUEST",
      documentId: null,
      version: null,
      content: "Hemograma completo",
    });
    expect(screen.getByRole("button", { name: /Documento 1/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("textbox", { name: "Solicitação de exames" })).toHaveValue(
      "Hemograma completo",
    );
  });

  it("requires discarding unsaved edits before switching documents, and final documents cannot be edited", async () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    const writes = renderCard([
      {
        id: "final-document",
        title: "Receita final",
        content: "Conteúdo final",
        type: "PRESCRIPTION",
        status: "FINAL",
        version: 2,
        authorName: "Profissional",
      },
    ]);
    fireEvent.change(await screen.findByRole("textbox", { name: "Prescrição" }), {
      target: { value: "Rascunho local" },
    });
    const saved = screen.getByRole("button", { name: /Documento 1/ });
    fireEvent.click(saved);
    expect(confirm).toHaveBeenCalledOnce();
    expect(screen.getByRole("textbox", { name: "Prescrição" })).toHaveValue("Rascunho local");
    confirm.mockReturnValue(true);
    fireEvent.click(saved);
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Prescrição" })).toBeDisabled());
    expect(screen.queryByRole("button", { name: "Salvar rascunho" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Imprimir / salvar PDF" })).toHaveAttribute(
      "href",
      "/api/v1/inventory/encounter-documents?documentId=final-document&print=true",
    );
    expect(writes).toHaveLength(0);
  });
});
