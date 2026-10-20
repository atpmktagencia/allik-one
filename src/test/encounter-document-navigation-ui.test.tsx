import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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

function workspace(
  access: { canAuthor: boolean; allowedDocumentTypes?: string[] } = { canAuthor: true },
) {
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) =>
    Response.json({
      data: {
        documents: [
          {
            id: "rx",
            type: "PRESCRIPTION",
            title: "RECEITA MÉDICA",
            content: "Receita original",
            status: "DRAFT",
            version: 1,
            authorName: "Profissional sintético",
            professionalCouncil: "CRM",
            councilNumber: "",
            councilRegion: "",
            canEdit: true,
          },
          {
            id: "request",
            type: "EXAM_REQUEST",
            title: "SOLICITAÇÃO DE EXAMES",
            content: "Solicitação original",
            status: "DRAFT",
            version: 1,
            authorName: "Profissional sintético",
            professionalCouncil: "CRM",
            councilNumber: "",
            councilRegion: "",
            canEdit: true,
          },
        ],
        templates: [],
        canAuthor: access.canAuthor,
        allowedDocumentTypes: access.allowedDocumentTypes,
      },
    }),
  );
  vi.stubGlobal("fetch", fetch);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const component = (mode: "prescription" | "requests") => (
    <QueryClientProvider client={client}>
      <EncounterDocumentsCard appointmentId="appointment-1" mode={mode} />
    </QueryClientProvider>
  );
  const view = render(component("prescription"));
  return { fetch, switchTo: (mode: "prescription" | "requests") => view.rerender(component(mode)) };
}
async function edit(text: string) {
  const element = await screen.findByRole("textbox", { name: "Conteúdo do documento" });
  const editor = (element as HTMLElement & { editor: Editor }).editor;
  act(() => {
    editor.commands.insertContent(text);
  });
  return element;
}

describe("Encounter document step navigation", () => {
  it.each([{ canAuthor: false }, { canAuthor: true, allowedDocumentTypes: [] }])(
    "does not recommend an unavailable creation action: %o",
    async (access) => {
      const view = workspace(access);
      view.switchTo("requests");
      fireEvent.click(await screen.findByRole("button", { name: "Encaminhamentos" }));
      expect(
        await screen.findByText(
          "Nenhuma solicitação nesta categoria. A inclusão depende do profissional responsável e das permissões de emissão.",
        ),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Novo documento" })).not.toBeInTheDocument();
      expect(screen.queryByText(/Use Novo documento/)).not.toBeInTheDocument();
    },
  );
  it("preserves independent unsaved buffers across repeated prescription/request changes", async () => {
    const view = workspace();
    fireEvent.click(await screen.findByRole("button", { name: "Receitas e histórico" }));
    await screen.findByRole("button", { name: "Medicamentos" });
    for (const name of [
      "Medicamentos",
      "Manipulados",
      "Injetáveis",
      "Suplementos",
      "Orientações",
      "Modelos",
    ])
      expect(
        within(screen.getByLabelText("Categorias de prescrição")).getByRole("button", { name }),
      ).toBeInTheDocument();
    await edit(" receita não salva");
    expect(screen.getByRole("tab", { name: /Receita 1/ })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Exames 1/ })).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("complementary", { name: "Prévia da prescrição" })).getByText(
        /receita não salva/,
      ),
    ).toBeInTheDocument();
    view.switchTo("requests");
    if (screen.queryByRole("button", { name: "Editar" }))
      fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    await edit(" pedido não salvo");
    expect(screen.getByRole("tab", { name: /Exames 1/ })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Receita 1/ })).not.toBeInTheDocument();
    view.switchTo("prescription");
    expect(await screen.findByRole("textbox", { name: "Conteúdo do documento" })).toHaveTextContent(
      "receita não salva",
    );
    view.switchTo("requests");
    if (screen.queryByRole("button", { name: "Editar" }))
      fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    expect(await screen.findByRole("textbox", { name: "Conteúdo do documento" })).toHaveTextContent(
      "pedido não salvo",
    );
    fireEvent.click(screen.getByRole("button", { name: "Encaminhamentos" }));
    expect(
      screen.queryByRole("textbox", { name: "Conteúdo do documento" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Exames laboratoriais" }));
    if (screen.queryByRole("button", { name: "Editar" }))
      fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    expect(await screen.findByRole("textbox", { name: "Conteúdo do documento" })).toHaveTextContent(
      "pedido não salvo",
    );
    expect(view.fetch.mock.calls.some((call) => call[1]?.method === "POST")).toBe(false);
  });
});
