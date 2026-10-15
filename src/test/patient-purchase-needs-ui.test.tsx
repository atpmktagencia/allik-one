import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { PatientPurchaseNeedsPage } from "@/components/clinic/patient-purchase-needs-page";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="#purchase">{children}</a>,
}));

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
      <PatientPurchaseNeedsPage />
    </QueryClientProvider>,
  );
}

describe("Patient purchase needs UI", () => {
  it("shows quantity, deadline and estimated cost and reloads filters", async () => {
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        requests.push(String(input));
        return Response.json({
          data: {
            horizon: 30,
            leadDays: 7,
            summary: {
              products: 1,
              needingPurchase: 1,
              missingPresentation: 0,
              estimatedCost: 200,
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
                presentationName: "Tirzepatida 20 mg",
                usablePerPresentation: 18,
                beyondUseHours: 24,
                acquisitionCost: 100,
                physicalUnits: 2,
                pendingUnits: 0,
                openQuantity: 0,
                requiredUnits: 4,
                recommendedUnits: 2,
                netAfterPending: 2,
                firstShortageOn: "2026-10-25",
                suggestedOrderBy: "2026-10-18",
                estimatedCost: 200,
                supplierName: "Stin Pharma",
                supplierId: "11111111-1111-4111-8111-111111111111",
                catalogItemId: "22222222-2222-4222-8222-222222222222",
                catalogCode: "STIN-P110",
                catalogPrice: "100.00",
              },
            ],
          },
        });
      }),
    );
    mount();
    expect(await screen.findByText("2 un.")).toBeInTheDocument();
    expect(screen.getByText("Comprar até 18/10/2026")).toBeInTheDocument();
    expect(screen.getAllByText(/R\$\s*200,00/).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Preparar pedido" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Prazo do fornecedor"), { target: { value: "14" } });
    await waitFor(() => expect(requests.some((url) => url.includes("leadDays=14"))).toBe(true));
    fireEvent.click(await screen.findByRole("button", { name: "60 dias" }));
    await waitFor(() =>
      expect(
        requests.some((url) => url.includes("horizon=60") && url.includes("leadDays=14")),
      ).toBe(true),
    );
  });

  it("shows an empty planning state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          data: {
            horizon: 30,
            leadDays: 7,
            summary: { products: 0, needingPurchase: 0, missingPresentation: 0, estimatedCost: 0 },
            items: [],
          },
        }),
      ),
    );
    mount();
    expect(
      await screen.findByText("Nenhuma aplicação prevista neste período."),
    ).toBeInTheDocument();
  });
});
