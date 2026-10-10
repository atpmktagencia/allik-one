import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SalePricesPage } from "@/components/clinic/sale-prices-page";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <SalePricesPage />
    </QueryClientProvider>,
  );
}

const payload = {
  presentations: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      productId: null,
      name: "Tirzepatida 20 mg / 0,8 mL",
      baseUnit: "MG",
      totalBaseQuantity: "20",
      totalVolumeMl: "0.8",
      concentrationPerMl: "25",
      acquisitionCost: "591.4",
      technicalLossPercent: "0",
      additionalPresentationCost: "0",
      minimumMeasurableVolumeMl: "0.01",
      beyondUseHours: 24,
      active: true,
      version: 2,
      doses: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          name: "Dose 2,5 mg",
          doseQuantity: "2.5",
          salePrice: "250",
          materialCost: "10",
          active: true,
          version: 3,
          calculation: {
            dosesPerPresentation: 8,
            probableRemainder: "0",
            doseVolumeMl: "0.1",
            measurable: true,
            costPerDose: "83.925",
            marginPerDose: "166.075",
            grossResultPerPresentation: "1328.6",
          },
        },
      ],
    },
  ],
  products: [],
  legacyPrices: [],
  canManage: true,
};

describe("Pricing UI", () => {
  it("compares calculated doses and loads audited presentation and dose edits", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ data: payload })),
    );
    mount();

    expect(await screen.findByText("Comparação por dose e apresentação")).toBeInTheDocument();
    expect(screen.getAllByText("R$ 83,93").length).toBeGreaterThan(0);
    expect(screen.getByText("R$ 1.328,60")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Editar apresentação" }));
    expect(screen.getByRole("heading", { name: "Editar apresentação" })).toBeInTheDocument();
    expect(screen.getByLabelText("Nome da apresentação")).toHaveValue("Tirzepatida 20 mg / 0,8 mL");
    expect(screen.getByLabelText("Custo da apresentação")).toHaveValue("591.4");

    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    expect(screen.getByRole("heading", { name: "Editar dose comercializada" })).toBeInTheDocument();
    expect(screen.getByLabelText("Preço de venda da dose")).toHaveValue("250");
    expect(screen.getByLabelText("Materiais por dose")).toHaveValue("10");
  });
});
