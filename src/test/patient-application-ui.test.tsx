import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: React.PropsWithChildren) => <a>{children}</a>,
}));

import { PatientTreatmentPage } from "@/components/clinic/patient-treatment-page";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("Patient application UI", () => {
  it("requires explicit confirmation and sends the scheduled application", async () => {
    const patientId = "11111111-1111-4111-8111-111111111111";
    const scheduleId = "22222222-2222-4222-8222-222222222222";
    const locationId = "33333333-3333-4333-8333-333333333333";
    let submitted: Record<string, unknown> | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        if (init?.method === "POST") {
          submitted = JSON.parse(String(init.body)) as Record<string, unknown>;
          return Response.json({ data: { id: submitted["operationId"] } }, { status: 201 });
        }
        return Response.json({
          data: {
            patient: {
              id: patientId,
              fullName: "Paciente Sintético",
              internalCode: "PAC-TESTE",
              unitName: "Fortaleza",
              active: true,
            },
            treatments: [
              {
                id: "44444444-4444-4444-8444-444444444444",
                productId: "55555555-5555-4555-8555-555555555555",
                productName: "Produto Sintético",
                sku: "TESTE-01",
                doseQuantity: "2.5",
                doseUnit: "MG",
                route: "SC",
                frequencyEveryDays: "7",
                firstScheduledOn: "2026-10-12",
                plannedAdministrations: 1,
                status: "PLANNED",
                version: 0,
              },
            ],
            prescriptions: [],
            products: [],
            purchases: [],
            schedule: [
              {
                id: scheduleId,
                treatmentId: "44444444-4444-4444-8444-444444444444",
                sequence: 1,
                scheduledOn: "2026-10-12",
                doseQuantity: "2.5",
                doseUnit: "MG",
                status: "RESERVED",
                version: 3,
                hasValidPrescription: true,
                applicationId: null,
                applicationReference: null,
                applicationProfessional: null,
                physicalQuantity: null,
                administeredAt: null,
              },
            ],
            locations: [{ id: locationId, name: "Estoque Central" }],
            supplySummaries: [
              {
                treatmentId: "44444444-4444-4444-8444-444444444444",
                purchasedQuantity: 10,
                reservedQuantity: 2.5,
                consumedQuantity: 2.5,
                plannedQuantity: 5,
                purchasedRemaining: 7.5,
                purchasedAvailableToReserve: 5,
                presentationName: "Apresentação sintética",
                usablePerPresentation: 20,
                availableStockUnits: 1,
                openQuantity: 7.5,
                physicalAvailableDose: 27.5,
                physicalUnreservedDose: 25,
                requiredPresentationUnits: 1,
                shortageUnits: 0,
                unitDemandQuantity: 7.5,
                unitReservedQuantity: 2.5,
                unitRequiredPresentationUnits: 1,
                unitShortageUnits: 0,
              },
            ],
            canManage: false,
            canConsume: true,
          },
        });
      }),
    );
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <PatientTreatmentPage patientId={patientId} />
      </QueryClientProvider>,
    );
    expect(await screen.findByText(/Disponível para reservar:/)).toHaveTextContent("5 MG");
    expect(screen.getByText(/Livre após reservas:/)).toHaveTextContent("25 MG");
    fireEvent.click(await screen.findByRole("button", { name: "Registrar aplicação" }));
    const confirmButton = screen.getByRole("button", { name: "Confirmar aplicação" });
    expect(confirmButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Profissional executor"), {
      target: { value: "Profissional de Teste" },
    });
    fireEvent.click(
      screen.getByLabelText(/conferi paciente, dose, produto, profissional e local/i),
    );
    fireEvent.click(confirmButton);
    await waitFor(() => expect(submitted).toBeDefined());
    expect(submitted).toEqual(
      expect.objectContaining({
        patientId,
        scheduleId,
        scheduleVersion: 3,
        locationId,
        professional: "Profissional de Teste",
      }),
    );
  });
});
