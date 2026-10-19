import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrescriptionComposer } from "@/components/clinic/prescription-composer";
import { PlanQuotePanel } from "@/components/clinic/plan-quote-panel";
const state = vi.hoisted(() => ({ resources: [] as string[], canExport: false }));
const quote = {
  lines: [
    {
      candidateKey: "commercial-key",
      originItemId: "source",
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
      priceSource: "Tabela autorizada",
      validFrom: "2020-01-01",
      validUntil: null,
    },
  ],
  subtotal: "25.00",
  knownSubtotal: "25.00",
  discountBps: 0,
  discountAmount: "0.00",
  total: "25.00",
  complete: true,
  previewHash: "a".repeat(64),
  referenceDate: "2026-10-19",
  planVersion: 1,
};
vi.mock("@/data/inventory-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/data/inventory-api")>()),
  useInventory: (resource: string) => {
    state.resources.push(resource);
    return {
      data: resource.startsWith("composer-plan-options")
        ? {
            patientId: "patient",
            unitId: "unit",
            unitName: "Unidade sintética",
            canReadPlans: true,
            plans: [
              {
                id: "saved-plan",
                title: "Plano explícito salvo",
                version: 1,
                status: "ACTIVE",
                unitId: "unit",
                unitName: "Unidade sintética",
                canEstimate: true,
                linkedToDocument: false,
              },
            ],
          }
        : resource.startsWith("plan-quotes")
          ? {
              estimates: [],
              planVersion: 1,
              unitId: "unit",
              unitName: "Unidade sintética",
              canPreview: true,
              canSave: true,
              canDiscount: false,
              canReadClinical: false,
              ...(resource.includes("quoteId=")
                ? {
                    record: {
                      id: "quote",
                      createdAt: "2026-10-19T00:00:00Z",
                      planVersion: 1,
                      version: 1,
                      status: "ESTIMATE",
                    },
                    snapshot: {
                      lines: [],
                      knownSubtotal: "0.00",
                      subtotal: null,
                      total: null,
                      discountBps: 0,
                      discountAmount: null,
                      complete: false,
                    },
                    revision: 1,
                    canExport: state.canExport,
                  }
                : {}),
            }
          : { templates: [], canCompose: true },
      isPending: false,
      error: null,
      refetch: vi.fn(),
    };
  },
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  state.resources = [];
  state.canExport = false;
});
describe("Prescription and estimate workspace", () => {
  it("loads quote options lazily, requires a saved plan, and preserves independent recipe and commercial drafts across accessible tabs", async () => {
    const requests: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init: RequestInit) => {
        requests.push(JSON.parse(String(init.body)));
        return Response.json({ data: quote });
      }),
    );
    render(
      <PrescriptionComposer appointmentId="appointment" documentId="document" onInsert={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText("Nome do componente"), {
      target: { value: "Fórmula não salva" },
    });
    expect(state.resources.some((resource) => resource.startsWith("composer-plan-options"))).toBe(
      false,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Orçamento" }));
    expect(screen.getByLabelText("Nome do componente")).toBeVisible();
    expect(screen.getByLabelText("Prévia do documento")).toContainElement(
      screen.getByRole("tablist", { name: "Receita e orçamento" }),
    );
    expect(
      screen.getByRole("combobox", { name: "Plano clínico salvo para estimativa" }),
    ).toHaveValue("");
    expect(state.resources.some((resource) => resource.startsWith("plan-quotes"))).toBe(false);
    expect(requests).toHaveLength(0);
    fireEvent.change(
      screen.getByRole("combobox", { name: "Plano clínico salvo para estimativa" }),
      { target: { value: "saved-plan" } },
    );
    expect(screen.getByText(/Este plano é independente do documento/)).toBeInTheDocument();
    expect(requests).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Calcular estimativa" }));
    await waitFor(() =>
      expect(
        screen.getByRole("textbox", { name: "Quantidade comercial (ajuste explícito)" }),
      ).toBeInTheDocument(),
    );
    expect(requests[0]).toMatchObject({
      action: "PREVIEW",
      planId: "saved-plan",
      expectedPlanVersion: 1,
      overrides: [],
    });
    expect(requests[0]).not.toHaveProperty("formula");
    fireEvent.change(
      screen.getByRole("textbox", { name: "Quantidade comercial (ajuste explícito)" }),
      { target: { value: "3" } },
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "Unidade comercial (ajuste explícito)" }),
      { target: { value: "SESSION" } },
    );
    fireEvent.keyDown(screen.getByRole("tab", { name: "Orçamento" }), {
      key: "ArrowLeft",
    });
    expect(screen.getByRole("tab", { name: "Receita" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("Nome do componente")).toHaveValue("Fórmula não salva");
    fireEvent.keyDown(screen.getByRole("tab", { name: "Receita" }), {
      key: "ArrowRight",
    });
    expect(
      screen.getByRole("textbox", { name: "Quantidade comercial (ajuste explícito)" }),
    ).toHaveValue("3");
    expect(
      screen.getByRole("textbox", { name: "Unidade comercial (ajuste explícito)" }),
    ).toHaveValue("SESSION");
    expect(screen.getByRole("button", { name: "Salvar estimativa" })).toBeDisabled();
    expect(
      screen.queryByRole("link", { name: "Exportar proposta estimada" }),
    ).not.toBeInTheDocument();
    expect(requests).toHaveLength(1);
    act(() => window.dispatchEvent(new CustomEvent("inventory-unit-change")));
    expect(screen.getByRole("tab", { name: "Receita" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("Nome do componente")).toHaveValue("");
  });
  it("offers authenticated export only for an explicitly authorized stored snapshot revision", () => {
    const view = render(<PlanQuotePanel planId="saved-plan" initialQuoteId="quote" />);
    expect(
      screen.queryByRole("link", { name: "Exportar proposta estimada" }),
    ).not.toBeInTheDocument();
    state.canExport = true;
    view.rerender(<PlanQuotePanel planId="saved-plan" initialQuoteId="quote" />);
    const link = screen.getByRole("link", { name: "Exportar proposta estimada" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("href")).toContain("format=proposal");
    expect(link.getAttribute("href")).toContain("quoteId=quote");
    expect(link.getAttribute("href")).toContain("revision=1");
  });
});
