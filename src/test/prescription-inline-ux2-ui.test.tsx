import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EncounterDocumentsCard } from "@/components/clinic/encounter-documents-card";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Prescription inline UX2", () => {
  it("does not create a draft while entering or navigating, then creates and associates explicitly", async () => {
    const writes: Record<string, unknown>[] = [];
    let documents: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          const body = JSON.parse(String(init.body)) as Record<string, unknown>;
          writes.push(body);
          if (url.includes("prescription-composer")) {
            return Response.json({
              data:
                body["action"] === "PREVIEW"
                  ? {
                      text: "Composição revisada",
                      quantity: 1,
                      quantityLabel: "1 unidade",
                      warnings: [],
                    }
                  : {
                      text: "Composição revisada",
                      instanceId: "instance-1",
                      quantity: 1,
                      quantityLabel: "1 unidade",
                      warnings: [],
                    },
            });
          }
          const id = String(body["documentId"] ?? body["creationId"] ?? "draft-1");
          const version = body["documentId"] ? Number(body["version"]) + 1 : 0;
          documents = [
            {
              id,
              type: "PRESCRIPTION",
              title: body["title"],
              content: body["content"] ?? "",
              richContent: body["richContent"] ?? null,
              twoCopies: false,
              version,
              status: "DRAFT",
              authorName: "Profissional",
              canEdit: true,
            },
          ];
          return Response.json({ data: { id, version } });
        }
        if (url.includes("prescription-composer"))
          return Response.json({ data: { templates: [], canCompose: true, units: [] } });
        return Response.json({
          data: {
            documents,
            templates: [],
            canAuthor: true,
            context: {
              patientName: "Paciente sintético",
              birthDate: null,
              unitName: "Unidade sintética",
              allergies: null,
              prescriptionPrintData: {
                kind: "SIMPLE",
                patientDocument: "",
                patientAddress: "",
                patientAge: null,
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

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const card = (mode: "prescription" | "requests") => (
      <QueryClientProvider client={client}>
        <EncounterDocumentsCard appointmentId="00000000-0000-0000-0000-000000000001" mode={mode} />
      </QueryClientProvider>
    );
    const view = render(card("prescription"));

    await screen.findByText("Protocolos pessoais / padrão");
    expect(writes).toHaveLength(0);

    for (const [label, value] of [
      ["Nome do componente", "Componente sintético"],
      ["Quantidade por unidade", "1"],
      ["Unidade da quantidade (ex.: mg)", "mg"],
      ["Apresentação (unidade de administração)", "cápsula"],
      ["Via de administração", "oral"],
      ["Unidades por administração", "1"],
      ["Administrações por dia", "1"],
      ["Duração em dias", "1"],
    ] as const)
      fireEvent.change(screen.getByLabelText(label), { target: { value } });

    view.rerender(card("requests"));
    await screen.findByRole("heading", { name: "Solicitações do atendimento" });
    view.rerender(card("prescription"));
    expect(await screen.findByLabelText("Nome do componente")).toHaveValue("Componente sintético");
    expect(screen.getByLabelText("Quantidade por unidade")).toHaveValue("1");
    expect(writes).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: /^Calcular e revisar composição$/ }));
    const insert = await screen.findByRole("button", {
      name: "Criar rascunho e inserir composição",
    });
    fireEvent.click(screen.getByLabelText(/^Conferi composição/));
    fireEvent.click(insert);

    await waitFor(() =>
      expect(writes.filter((body) => body["action"] === "INSTANTIATE")).toHaveLength(1),
    );
    expect(writes[0]).toMatchObject({ action: "PREVIEW" });
    expect(writes[1]).toMatchObject({
      action: "SAVE_DRAFT",
      documentId: null,
      type: "PRESCRIPTION",
    });
    expect(writes[2]).toMatchObject({
      action: "INSTANTIATE",
      documentId: writes[1]?.["creationId"],
    });
    fireEvent.click(screen.getByRole("button", { name: "Documentos e assinatura" }));
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Conteúdo do documento" })).toHaveTextContent(
        "Composição revisada",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    await waitFor(() =>
      expect(writes.filter((body) => body["action"] === "SAVE_DRAFT")).toHaveLength(2),
    );
    expect(writes.at(-1)).toMatchObject({
      action: "SAVE_DRAFT",
      documentId: writes[1]?.["creationId"],
      version: 0,
    });
  });
});
