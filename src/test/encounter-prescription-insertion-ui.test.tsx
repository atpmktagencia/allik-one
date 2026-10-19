import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { EncounterPrescriptionCard } from "@/components/clinic/encounter-prescription-card";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("copies only the explicitly requested saved therapeutic snapshot and blocks unsaved changes", async () => {
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) =>
    Response.json({
      data: {
        canAuthor: true,
        products: [],
        prescription: {
          id: "rx",
          status: "DRAFT",
          version: 1,
          authorName: "Profissional sintético",
          professionalCouncil: "CRM",
          councilNumber: "",
          councilRegion: "",
          finalizedAt: null,
          updatedAt: "2026-10-19",
          generalInstructions: "Reavaliar no retorno.",
          items: [
            {
              id: "item-1",
              productId: null,
              medicationName: "Medicamento sintético",
              doseQuantity: 10,
              doseUnit: "MG",
              doseUnitOther: "",
              route: "Oral",
              frequencyEvery: 1,
              frequencyUnit: "DAY",
              durationAmount: 30,
              durationUnit: "DAY",
              continuousUse: false,
              plannedAdministrations: null,
              instructions: "Orientação preenchida pelo profissional.",
            },
          ],
        },
      },
    }),
  );
  vi.stubGlobal("fetch", fetch);
  const insert = vi.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <EncounterPrescriptionCard appointmentId="appointment-1" onInsertIntoDocument={insert} />
    </QueryClientProvider>,
  );
  const button = await screen.findByRole("button", { name: "Inserir itens na receita" });
  expect(insert).not.toHaveBeenCalled();
  fireEvent.click(button);
  expect(insert).toHaveBeenCalledTimes(1);
  expect(insert.mock.calls[0]?.[1]).toEqual({
    prescriptionId: "rx",
    version: 1,
    updatedAt: "2026-10-19",
  });
  expect(insert.mock.calls[0]?.[0]).toContain("Dose: 10 mg. Via: Oral.");
  expect(insert.mock.calls[0]?.[0]).toContain("A cada 1 dia(s). Durante 30 dia(s).");
  expect(insert.mock.calls[0]?.[0]).toContain("Orientações gerais: Reavaliar no retorno.");
  fireEvent.click(screen.getByRole("button", { name: "Editar item 1" }));
  fireEvent.change(screen.getByLabelText("Dose"), { target: { value: "20" } });
  expect(button).toBeDisabled();
  expect(fetch.mock.calls.some((call) => call[1]?.method === "POST")).toBe(false);
});

it("starts clinical quantities and units blank and does not prefill duration when continuous use is cleared", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ data: { prescription: null, products: [], canAuthor: true } }),
    ),
  );
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <EncounterPrescriptionCard appointmentId="synthetic-empty" />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Adicionar item" }));
  for (const label of [
    "Dose",
    "Intervalo da frequência do item 1",
    "Quantidade da duração do item 1",
  ])
    expect(screen.getByLabelText(label)).toHaveValue(null);
  for (const label of [
    "Unidade",
    "Unidade da frequência do item 1",
    "Unidade da duração do item 1",
  ])
    expect(screen.getByLabelText(label)).toHaveValue("");
  fireEvent.click(screen.getByLabelText("Uso contínuo"));
  fireEvent.click(screen.getByLabelText("Uso contínuo"));
  expect(screen.getByLabelText("Quantidade da duração do item 1")).toHaveValue(null);
  expect(screen.getByLabelText("Unidade da duração do item 1")).toHaveValue("");
  fireEvent.change(screen.getByLabelText("Número de aplicações (opcional)"), {
    target: { value: "4" },
  });
  expect(screen.getByLabelText("Justificativa para o número de aplicações")).toHaveValue("");
  fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/justifique/);
  expect(vi.mocked(fetch).mock.calls.some((call) => call[1]?.method === "POST")).toBe(false);
});

function savedPrescription(version = 1, quantity = 10) {
  return {
    canAuthor: true,
    products: [],
    prescription: {
      id: "synthetic-rx",
      version,
      status: "DRAFT",
      generalInstructions: "",
      authorName: "Sintético",
      professionalCouncil: "CRM",
      councilNumber: "123",
      councilRegion: "CE",
      finalizedAt: null,
      updatedAt: "2026-10-19",
      items: [
        {
          id: "synthetic-item",
          productId: null,
          medicationName: "Medicamento sintético",
          doseQuantity: quantity,
          doseUnit: "MG",
          doseUnitOther: "",
          route: "Oral",
          frequencyEvery: 1,
          frequencyUnit: "DAY",
          durationAmount: 30,
          durationUnit: "DAY",
          continuousUse: false,
          plannedAdministrations: null,
          instructions: "",
        },
      ],
    },
  };
}
it("keeps the edited base version and local buffer when a newer server version arrives", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const transport = vi.fn(async (_url: unknown, init?: RequestInit) =>
    init?.method === "POST"
      ? Response.json({ error: "A prescrição mudou em outra sessão." }, { status: 409 })
      : Response.json({ data: savedPrescription() }),
  );
  vi.stubGlobal("fetch", transport);
  render(
    <QueryClientProvider client={client}>
      <EncounterPrescriptionCard appointmentId="versioned" />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Editar item 1" }));
  fireEvent.change(screen.getByLabelText("Dose"), { target: { value: "20" } });
  act(() => {
    client.setQueriesData({ queryKey: ["inventory"] }, savedPrescription(2, 15));
  });
  expect(screen.getByLabelText("Dose")).toHaveValue(20);
  fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
  await screen.findByRole("alert");
  const request = transport.mock.calls.find((call) => call[1]?.method === "POST");
  expect(JSON.parse(String(request?.[1]?.body))).toMatchObject({
    version: 1,
    items: [{ doseQuantity: 20 }],
  });
  expect(screen.getByLabelText("Dose")).toHaveValue(20);
});
it("reconciles a committed write after a lost response without posting twice or discarding the buffer", async () => {
  let payload = savedPrescription();
  const state = vi.fn();
  const transport = vi.fn(async (_url: unknown, init?: RequestInit) => {
    if (init?.method === "POST") {
      const input = JSON.parse(String(init.body));
      payload = {
        ...payload,
        prescription: { ...payload.prescription, version: 2, items: input.items },
      };
      throw new TypeError("Resposta perdida após gravação");
    }
    return Response.json({ data: payload });
  });
  vi.stubGlobal("fetch", transport);
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <EncounterPrescriptionCard appointmentId="ambiguous" onDraftStateChange={state} />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Editar item 1" }));
  fireEvent.change(screen.getByLabelText("Dose"), { target: { value: "20" } });
  fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
  fireEvent.click(await screen.findByRole("button", { name: "Conferir salvamento sem reenviar" }));
  await waitFor(() => expect(state).toHaveBeenLastCalledWith({ dirty: false, pending: false }));
  expect(screen.getByLabelText("Dose")).toHaveValue(20);
  expect(transport.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(1);
});
it("clears an existing draft explicitly without finalizing a prescription", async () => {
  let payload = savedPrescription();
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true),
  );
  const transport = vi.fn(async (_url: unknown, init?: RequestInit) => {
    if (init?.method === "POST") {
      const input = JSON.parse(String(init.body));
      expect(input).toMatchObject({
        action: "SAVE_DRAFT",
        version: 1,
        items: [],
        generalInstructions: "",
      });
      payload = { ...payload, prescription: { ...payload.prescription, version: 2, items: [] } };
      return Response.json({ data: { id: "synthetic-rx", version: 2, status: "DRAFT" } });
    }
    return Response.json({ data: payload });
  });
  vi.stubGlobal("fetch", transport);
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <EncounterPrescriptionCard appointmentId="clear" />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Limpar rascunho" }));
  await screen.findByText("Rascunho salvo.");
  expect(screen.getByText("Nenhum item adicionado à prescrição.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Finalizar prescrição" })).toBeDisabled();
});
