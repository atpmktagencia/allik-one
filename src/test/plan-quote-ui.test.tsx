import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlanQuotePanel } from "@/components/clinic/plan-quote-panel";
const state = vi.hoisted(() => ({ canDiscount: false }));
vi.mock("@/data/inventory-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/data/inventory-api")>()),
  useInventory: () => ({
    data: {
      estimates: [],
      planVersion: 1,
      unitId: "unit",
      unitName: "Unidade sintética",
      canPreview: true,
      canSave: true,
      canDiscount: state.canDiscount,
      canReadClinical: false,
    },
    isPending: false,
    error: null,
    refetch: vi.fn(async () => ({ data: { estimates: [] } })),
  }),
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  state.canDiscount = false;
});
const line = {
  candidateKey: "opaque-key",
  originItemId: "clinical-id",
  chargeGroup: "group",
  targetType: "CATALOG",
  targetId: "catalog",
  label: "Serviço comercial",
  billingMode: "SEPARATE",
  selected: true,
  canExclude: false,
  isOptional: false,
  status: "RESOLVED",
  reason: null,
  quantity: "2",
  unit: "SESSION",
  unitPrice: "12.50",
  subtotal: "25.00",
  priceId: "price",
  priceVersion: 1,
  mappingIds: [],
  priceSource: "Tabela aprovada",
  validFrom: "2020-01-01",
  validUntil: null,
};
function setup(snapshot: Record<string, unknown> = {}, conflictSave = false) {
  const requests: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      requests.push(body);
      if (body.action === "SAVE_ESTIMATE" && conflictSave)
        return Response.json(
          { error: "Preços alterados. Recalcule a estimativa." },
          { status: 409 },
        );
      return Response.json({
        data: {
          previewHash: "a".repeat(64),
          lines: [
            line,
            {
              ...line,
              candidateKey: "unknown",
              label: "Item comercial pendente",
              targetId: null,
              targetType: null,
              isOptional: true,
              canExclude: true,
              status: "UNRESOLVED",
              unitPrice: null,
              subtotal: null,
              reason: "Sem preço confirmado",
            },
          ],
          knownSubtotal: "25.00",
          subtotal: null,
          total: null,
          discountBps: 0,
          discountAmount: null,
          complete: false,
          referenceDate: "2026-10-18",
          planVersion: 1,
          unitId: "unit",
          ...snapshot,
        },
      });
    }),
  );
  render(<PlanQuotePanel planId="plan" expectedPlanVersion={1} />);
  return requests;
}
describe("Estimated plan quote UI", () => {
  it("keeps unresolved values pending, starts without automatic calculation and exposes no operational actions", async () => {
    const requests = setup();
    expect(requests).toHaveLength(0);
    expect(screen.queryByLabelText("Desconto percentual")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Calcular estimativa" }));
    await screen.findByText("Pendente — há itens sem valor confirmado");
    expect(screen.getByText("Subtotal do item: Valor pendente")).toBeInTheDocument();
    expect(screen.getAllByText("R$ 25,00").length).toBeGreaterThan(0);
    expect(
      screen.queryByRole("button", { name: /Aprovar|Pagar|Vender|Reservar|Baixar estoque/ }),
    ).not.toBeInTheDocument();
    expect(requests[0]).toMatchObject({ action: "PREVIEW", discountBps: 0, overrides: [] });
  });
  it("invalidates the snapshot and requires quantity and unit together for a commercial override", async () => {
    const requests = setup();
    fireEvent.click(screen.getByRole("button", { name: "Calcular estimativa" }));
    await screen.findByText("Subtotal do item: Valor pendente");
    expect(screen.getByRole("button", { name: "Salvar estimativa" })).toBeEnabled();
    fireEvent.change(screen.getAllByLabelText("Quantidade comercial (ajuste explícito)")[0]!, {
      target: { value: "3" },
    });
    expect(screen.getByRole("button", { name: "Salvar estimativa" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Calcular estimativa" })).toBeDisabled();
    fireEvent.change(screen.getAllByLabelText("Unidade comercial (ajuste explícito)")[0]!, {
      target: { value: "SESSION" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Calcular estimativa" }));
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]).toMatchObject({
      overrides: [{ candidateKey: "opaque-key", quantity: "3", unit: "SESSION", selected: true }],
    });
  });
  it("preserves exact cents for canonical monetary amounts beyond safe integer precision", async () => {
    setup({
      lines: [{ ...line, subtotal: "999999999999999999.99" }],
      knownSubtotal: "999999999999999999.99",
      subtotal: "999999999999999999.99",
      total: "999999999999999999.99",
      discountAmount: "0.00",
      complete: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "Calcular estimativa" }));
    await waitFor(() =>
      expect(screen.getAllByText("R$ 999.999.999.999.999.999,99")).toHaveLength(2),
    );
  });
  it("binds save to the reviewed preview hash without submitting prices and requires recalculation on a 409", async () => {
    const requests = setup({}, true);
    fireEvent.click(screen.getByRole("button", { name: "Calcular estimativa" }));
    await screen.findByText("Subtotal do item: Valor pendente");
    fireEvent.click(screen.getByRole("button", { name: "Salvar estimativa" }));
    await screen.findByRole("alert");
    expect(requests[1]).toMatchObject({
      action: "SAVE_ESTIMATE",
      expectedPreviewHash: "a".repeat(64),
      discountBps: 0,
      overrides: [],
    });
    for (const forbidden of ["lines", "prices", "unitPrice", "subtotal", "total", "knownSubtotal"])
      expect(requests[1]).not.toHaveProperty(forbidden);
    expect(screen.getByRole("button", { name: "Salvar estimativa" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Calcular estimativa" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Salvar estimativa" })).toBeEnabled(),
    );
  });
});
