import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  expect(insert.mock.calls[0]?.[0]).toContain("Dose: 10 mg. Via: Oral.");
  expect(insert.mock.calls[0]?.[0]).toContain("A cada 1 dia(s). Durante 30 dia(s).");
  expect(insert.mock.calls[0]?.[0]).toContain("Orientações gerais: Reavaliar no retorno.");
  fireEvent.click(screen.getByRole("button", { name: "Editar item 1" }));
  fireEvent.change(screen.getByLabelText("Dose"), { target: { value: "20" } });
  expect(button).toBeDisabled();
  expect(fetch.mock.calls.some((call) => call[1]?.method === "POST")).toBe(false);
});
