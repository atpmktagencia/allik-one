import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EncounterQuoteCard } from "@/components/clinic/encounter-quote-card";
const state = vi.hoisted(() => ({ payload: {} as Record<string, unknown> }));
vi.mock("@/data/inventory-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/data/inventory-api")>()),
  useInventory: () => ({ data: state.payload, isPending: false, error: null, refetch: vi.fn() }),
}));
afterEach(cleanup);
const item = {
  prescriptionItemId: "item",
  productId: "product",
  medicationName: "Clinical secret",
  doseQuantity: 99,
  doseUnit: "SECRET_DOSE",
  pricingDoseId: "price",
  pricingDoseName: "SECRET_PRICING_DOSE",
  presentationName: "Apresentação comercial",
  quantity: 2,
  unitSalePrice: 100,
  unitEstimatedCost: 35,
  subtotalSale: 200,
  subtotalEstimatedCost: 70,
};
function payload(flags: Record<string, boolean> = {}) {
  return {
    prescription: null,
    quote: {
      id: "quote",
      items: [item],
      commercialNotes: "",
      totalSale: "200",
      estimatedCost: "70",
      grossResult: "130",
      status: "ISSUED",
      version: 1,
      issuedAt: null,
      approvedAt: null,
      declinedAt: null,
      paidAt: null,
      paymentMethod: null,
      paymentReference: null,
    },
    pricingOptions: [],
    canManage: false,
    canApprove: false,
    canDecline: false,
    canRegisterPayment: false,
    canActivate: false,
    ...flags,
  };
}
describe("Quote disclosure capabilities", () => {
  it("shows commercial presentation and sale value without clinical fields or costs", () => {
    state.payload = payload({ canReadCosts: false, canReadClinical: false });
    render(<EncounterQuoteCard appointmentId="appointment" />);
    expect(screen.getAllByText("Apresentação comercial").length).toBeGreaterThan(0);
    expect(screen.getByText(/200,00/)).toBeInTheDocument();
    for (const name of [
      "Clinical secret",
      "SECRET_DOSE",
      "SECRET_PRICING_DOSE",
      "Custo estimado",
      "Resultado bruto estimado",
    ])
      expect(screen.queryByText(new RegExp(name))).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: /Emitir orçamento|Registrar aprovação|Registrar recusa/,
      }),
    ).not.toBeInTheDocument();
  });
  it("fails closed when disclosure flags are absent", () => {
    state.payload = payload();
    render(<EncounterQuoteCard appointmentId="appointment" />);
    expect(
      screen.queryByText(/Clinical secret|SECRET_DOSE|SECRET_PRICING_DOSE/),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Custo estimado")).not.toBeInTheDocument();
  });
  it("keeps clinician sale estimation without ever reading cost inputs", async () => {
    const option = {
      id: "price",
      presentationId: "presentation",
      name: "Preço validado",
      doseQuantity: "99",
      salePrice: "100",
      productId: "product",
      presentationName: "Apresentação comercial",
      baseUnit: "SECRET_DOSE",
    };
    for (const key of [
      "materialCost",
      "totalBaseQuantity",
      "acquisitionCost",
      "additionalPresentationCost",
      "technicalLossPercent",
    ])
      Object.defineProperty(option, key, {
        get() {
          throw new Error("Unauthorized cost read");
        },
      });
    state.payload = {
      ...payload({ canReadCosts: false, canReadClinical: true }),
      quote: null,
      prescription: {
        id: "rx",
        status: "FINAL",
        items: [
          {
            id: "item",
            productId: "product",
            medicationName: "Clinical secret",
            doseQuantity: 99,
            doseUnit: "SECRET_DOSE",
            plannedAdministrations: 2,
          },
        ],
      },
      pricingOptions: [option],
    };
    render(<EncounterQuoteCard appointmentId="appointment" />);
    await waitFor(() => expect(screen.getByText(/200,00/)).toBeInTheDocument());
    expect(screen.getByText("Clinical secret")).toBeInTheDocument();
    expect(screen.queryByText("Custo estimado")).not.toBeInTheDocument();
  });
  it("shows cost and result only with the explicit capability", () => {
    state.payload = payload({ canReadCosts: true, canReadClinical: true });
    render(<EncounterQuoteCard appointmentId="appointment" />);
    expect(screen.getByText("Custo estimado")).toBeInTheDocument();
    expect(screen.getByText("Resultado bruto estimado")).toBeInTheDocument();
    expect(screen.getByText(/70,00/)).toBeInTheDocument();
    expect(screen.getByText(/130,00/)).toBeInTheDocument();
  });
});
