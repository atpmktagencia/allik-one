import { describe, expect, it } from "vitest";
import { renderPlanQuoteProposal } from "../data/plan-quote-proposal";
describe("Saved commercial proposal renderer", () => {
  it("escapes all dynamic fields and preserves immutable price provenance without clinical data", () => {
    const html = renderPlanQuoteProposal(
      {
        unitId: "unit-frozen",
        referenceDate: "2030-01-01",
        sourcePlanVersion: 2,
        complete: true,
        total: "700.00",
        knownSubtotal: "700.00",
        discountAmount: "0.00",
        clinicalTitle: "SECRET",
        lines: [
          {
            label: '<img src=x onerror="alert(1)">',
            quantity: "7",
            unit: "SESSION",
            unitPrice: "100.00",
            subtotal: "700.00",
            status: "RESOLVED",
            priceSource: "<script>source</script>",
            priceVersion: 3,
            validFrom: "2029-01-01",
            validUntil: "2030-12-31",
          },
        ],
      },
      { quoteId: "saved-id", revision: 1, patientName: "<script>patient</script>" },
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img ");
    expect(html).not.toContain("SECRET");
    expect(html).toContain("&lt;img");
    expect(html).toContain("cadastro atual");
    expect(html).toContain("unit-frozen");
    expect(html).toContain("Preço v3");
    expect(html).toContain("2029-01-01 até 2030-12-31");
    expect(html).toContain("R$ 700,00");
    expect(html).toContain("ESTIMATIVA — NÃO APROVADA");
  });
  it("keeps unresolved totals pending rather than inventing zero", () => {
    const html = renderPlanQuoteProposal(
      {
        complete: false,
        total: null,
        knownSubtotal: "0.00",
        lines: [
          {
            label: "Service",
            quantity: null,
            unitPrice: null,
            subtotal: null,
            status: "UNRESOLVED",
          },
        ],
      },
      { quoteId: "saved", revision: 2, patientName: "Synthetic" },
    );
    expect(html).toContain("Total da estimativa: <strong>Pendente</strong>");
    expect(html).toContain("pendências não equivalem a zero");
    expect(html).toContain("Pendente de definição");
  });
});
