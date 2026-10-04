import { afterEach, describe, it, expect, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LotTracePage } from "@/components/clinic/lot-trace-page";
import type { LotTrace } from "@/data/lot-trace";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: React.PropsWithChildren) => <a>{children}</a>,
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const lotId = "11111111-1111-4111-8111-111111111111";
const event: LotTrace["events"][number] = {
  id: "movement-app",
  date: "2026-10-04T18:00:00.123456Z",
  type: "OUT",
  quantity: "-1.000",
  reference: "AP-TRACE",
  reason: "Consumo sintético",
  actor: "preview-operator",
  location: "Sala",
  receiptId: null,
  receiptReference: null,
  purchaseId: null,
  purchaseReference: null,
  supplierId: null,
  supplier: null,
  operationId: null,
  origin: null,
  destination: null,
  applicationId: "application",
  applicationReference: "AP-TRACE",
  patientRef: "demo-patient-a",
  service: "Procedimento sintético",
  professional: "Executor sintético",
  audit: [{ id: "audit", actor: "preview-operator", action: "OUT", date: "2026-10-04T18:00:00Z" }],
};
const trace: LotTrace = {
  lot: {
    id: lotId,
    number: "LOTE-TRACE",
    expiry: "2099-01-01",
    supplier: "Fornecedor sintético",
    unitCost: "2.0000",
    status: "AVAILABLE",
    productId: "product",
    product: "Material",
    unit: "un",
    productActive: true,
  },
  summary: {
    received: "5.000",
    consumed: "1.000",
    adjusted: "0",
    ledgerQuantity: "4.000",
    balanceQuantity: "4.000",
    totalEvents: 2,
    auditEntries: 2,
    auditedEvents: 2,
    reconciled: true,
  },
  balances: [
    {
      locationId: "location",
      location: "Sala",
      active: true,
      quantity: "4.000",
      ledgerQuantity: "4.000",
      matches: true,
    },
  ],
  events: [event],
  nextCursor: "next-page",
};
function mount() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <LotTracePage lotId={lotId} />
    </QueryClientProvider>,
  );
}
describe("Lot trace UI", () => {
  it("keeps the loaded history on a page failure and retries the same cursor", async () => {
    const pages: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("cursor=")) {
          pages.push(url);
          if (pages.length === 1)
            return Response.json({ error: "Página temporariamente indisponível" }, { status: 503 });
          return Response.json({
            data: {
              ...trace,
              nextCursor: null,
              events: [
                {
                  ...event,
                  id: "movement-receipt",
                  type: "IN",
                  quantity: "5.000",
                  receiptId: "receipt",
                  receiptReference: "REC-TRACE",
                  purchaseId: "purchase",
                  purchaseReference: "PO-TRACE",
                  supplier: "Fornecedor sintético",
                  applicationId: null,
                  applicationReference: null,
                  patientRef: null,
                },
              ],
            },
          });
        }
        return Response.json({ data: trace });
      }),
    );
    mount();
    expect(await screen.findByText("Aplicação: AP-TRACE · Paciente A.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Carregar mais movimentações" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Página temporariamente indisponível",
    );
    expect(screen.getByText("Aplicação: AP-TRACE · Paciente A.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(await screen.findByText("Recebimento: REC-TRACE")).toBeInTheDocument();
    expect(pages).toHaveLength(2);
    expect(pages[0]).toBe(pages[1]);
    expect(
      screen.queryByRole("button", { name: "Carregar mais movimentações" }),
    ).not.toBeInTheDocument();
  });
  it("offers Preview access on denial instead of showing synthetic fallback history", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "Entre para consultar" }, { status: 401 })),
    );
    mount();
    expect(await screen.findByText("Acessar demonstração")).toBeInTheDocument();
    expect(screen.queryByText("AP-TRACE")).not.toBeInTheDocument();
  });
  it("shows balance and missing audit divergences explicitly", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          data: {
            ...trace,
            summary: { ...trace.summary, reconciled: false, auditedEvents: 1 },
            balances: [{ ...trace.balances[0], matches: false }],
            nextCursor: null,
          },
        }),
      ),
    );
    mount();
    expect(
      await screen.findByText("Há divergência entre o saldo e as movimentações registradas."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Auditoria presente em 1 de 2 movimentos. Consulte os registros abaixo."),
    ).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Divergência" })).toBeInTheDocument();
  });
});
