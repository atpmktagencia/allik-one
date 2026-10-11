import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PatientDemandPage } from "@/components/clinic/patient-demand-page";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

function mount() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <PatientDemandPage />
    </QueryClientProvider>,
  );
}

describe("Patient demand UI", () => {
  it("shows coverage and reloads the selected horizon", async () => {
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        requests.push(String(input));
        return Response.json({
          data: {
            horizon: String(input).includes("horizon=60") ? 60 : 30,
            generatedOn: "2026-10-11T00:00:00.000Z",
            summary: {
              administrations: 4,
              patients: 1,
              products: 1,
              itemsWithShortage: 1,
              itemsWithoutPresentation: 0,
            },
            items: [
              {
                unitId: "unit-1",
                unitName: "Fortaleza",
                productId: "product-1",
                productName: "Tirzepatida 20 mg / 0,8 mL",
                sku: "STIN-P110",
                doseUnit: "MG",
                administrations: 4,
                patients: 1,
                plannedQuantity: 7.5,
                reservedQuantity: 2.5,
                demandQuantity: 10,
                firstScheduledOn: "2026-10-12",
                lastScheduledOn: "2026-11-02",
                presentationName: "Tirzepatida 20 mg / 0,8 mL",
                usablePerPresentation: 20,
                doseVolumeMl: 0.1,
                minimumMeasurableVolumeMl: 0.05,
                beyondUseHours: 24,
                measurementWarning: false,
                requiredStockUnits: 1,
                availableStockUnits: 0,
                shortageStockUnits: 1,
              },
            ],
          },
        });
      }),
    );
    mount();
    expect(await screen.findByText("Faltam 1 un.")).toBeInTheDocument();
    expect(screen.getByText("10 MG")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "60 dias" }));
    await waitFor(() => expect(requests.some((url) => url.includes("horizon=60"))).toBe(true));
  });

  it("shows an operational empty state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          data: {
            horizon: 30,
            generatedOn: "2026-10-11T00:00:00.000Z",
            summary: {
              administrations: 0,
              patients: 0,
              products: 0,
              itemsWithShortage: 0,
              itemsWithoutPresentation: 0,
            },
            items: [],
          },
        }),
      ),
    );
    mount();
    expect(
      await screen.findByText("Nenhuma aplicação planejada ou reservada neste período."),
    ).toBeInTheDocument();
  });
});
