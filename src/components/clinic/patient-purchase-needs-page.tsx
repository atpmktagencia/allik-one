import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { AlertTriangle, CalendarClock, PackageSearch, ShoppingCart } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useInventory } from "@/data/inventory-api";
import { InventoryState } from "./inventory-state";
import { PageHeader } from "./page-kit";

type PurchaseNeed = {
  unitId: string;
  unitName: string;
  productId: string;
  productName: string;
  sku: string;
  doseUnit: string;
  administrations: number;
  patients: number;
  presentationName: string | null;
  usablePerPresentation: number | null;
  beyondUseHours: number | null;
  acquisitionCost: number | null;
  physicalUnits: number;
  pendingUnits: number;
  openQuantity: number;
  requiredUnits: number | null;
  recommendedUnits: number | null;
  netAfterPending: number | null;
  firstShortageOn: string | null;
  suggestedOrderBy: string | null;
  estimatedCost: number | null;
  supplierName: string | null;
  catalogCode: string | null;
};
type Payload = {
  horizon: number;
  leadDays: number;
  items: PurchaseNeed[];
  summary: {
    products: number;
    needingPurchase: number;
    missingPresentation: number;
    estimatedCost: number;
  };
};
const horizons = [7, 30, 60, 90] as const;
const leadTimes = [3, 7, 14, 21] as const;
const quantityFormatter = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 6 });
const currencyFormatter = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const quantity = (value: number) => quantityFormatter.format(value);
const date = (value: string) => value.split("-").reverse().join("/");

export function PatientPurchaseNeedsPage() {
  const [horizon, setHorizon] = useState<(typeof horizons)[number]>(30);
  const [leadDays, setLeadDays] = useState<(typeof leadTimes)[number]>(7);
  const query = useInventory<Payload>(
    `patient-purchase-needs?horizon=${horizon}&leadDays=${leadDays}`,
  );
  if (query.isPending || query.error)
    return (
      <InventoryState pending={query.isPending} error={query.error} retry={() => query.refetch()} />
    );
  const data = query.data!;
  const cards = [
    { label: "Produtos planejados", value: data.summary.products, icon: PackageSearch },
    { label: "Precisam de compra", value: data.summary.needingPurchase, icon: ShoppingCart },
    {
      label: "Cadastros incompletos",
      value: data.summary.missingPresentation,
      icon: AlertTriangle,
    },
    {
      label: "Custo adicional estimado",
      value: currencyFormatter.format(data.summary.estimatedCost),
      icon: CalendarClock,
    },
  ];
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Planejamento de abastecimento"
        title="Necessidade de compra"
        description="Projeta a primeira ruptura e a quantidade adicional com base na agenda, reservas, perdas, frascos abertos e pedidos ainda não recebidos."
        action={
          <Button asChild>
            <Link to="/estoque/fornecedores">Fazer compra</Link>
          </Button>
        }
      />
      <div className="flex flex-wrap gap-4">
        <div className="flex flex-wrap gap-2" aria-label="Horizonte de planejamento">
          {horizons.map((value) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={horizon === value ? "default" : "outline"}
              aria-pressed={horizon === value}
              onClick={() => setHorizon(value)}
            >
              {value} dias
            </Button>
          ))}
        </div>
        <label className="ml-auto flex items-center gap-2 text-sm font-medium">
          Prazo do fornecedor
          <select
            className="h-9 rounded-md border bg-background px-3"
            value={leadDays}
            onChange={(event) => setLeadDays(Number(event.target.value) as typeof leadDays)}
          >
            {leadTimes.map((value) => (
              <option key={value} value={value}>
                {value} dias
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="rounded-xl border bg-card p-5 shadow-soft">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{card.label}</p>
              <card.icon className="size-4 text-primary" aria-hidden="true" />
            </div>
            <p className="mt-2 font-display text-2xl font-semibold">{card.value}</p>
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning-foreground">
        Pedidos em aberto reduzem a sugestão líquida, mas não eliminam o alerta de ruptura porque
        ainda não possuem data de chegada confirmada.
      </div>
      <section className="overflow-hidden rounded-xl border bg-card">
        {data.items.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1180px] text-left text-sm">
              <caption className="sr-only">Necessidade de compra por unidade e produto</caption>
              <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-5 py-3">Unidade / produto</th>
                  <th className="px-4 py-3">Demanda</th>
                  <th className="px-4 py-3">Cobertura</th>
                  <th className="px-4 py-3">Comprar</th>
                  <th className="px-4 py-3">Prazo</th>
                  <th className="px-5 py-3">Fornecedor</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.items.map((item) => (
                  <tr key={`${item.unitId}:${item.productId}:${item.doseUnit}`}>
                    <td className="px-5 py-4 align-top">
                      <p className="font-medium">{item.productName}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.unitName} · {item.sku}
                      </p>
                    </td>
                    <td className="px-4 py-4 align-top">
                      <p>{item.administrations} aplicação(ões)</p>
                      <p className="text-xs text-muted-foreground">
                        {item.patients} paciente(s) · {horizon} dias
                      </p>
                    </td>
                    <td className="px-4 py-4 align-top">
                      <p>{quantity(item.physicalUnits)} un. físicas</p>
                      <p className="text-xs text-muted-foreground">
                        {quantity(item.openQuantity)} {item.doseUnit} abertos ·{" "}
                        {quantity(item.pendingUnits)} un. em pedido
                      </p>
                    </td>
                    <td className="px-4 py-4 align-top">
                      {item.netAfterPending === null ? (
                        <Badge variant="destructive">Revisar apresentação</Badge>
                      ) : item.netAfterPending > 0 ? (
                        <>
                          <Badge variant="destructive">{quantity(item.netAfterPending)} un.</Badge>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {item.estimatedCost === null
                              ? "Custo não cadastrado"
                              : currencyFormatter.format(item.estimatedCost)}
                          </p>
                        </>
                      ) : (
                        <Badge variant="outline">Sem compra adicional</Badge>
                      )}
                      <p className="mt-1 text-xs text-muted-foreground">
                        Necessidade bruta:{" "}
                        {item.requiredUnits === null ? "—" : `${quantity(item.requiredUnits)} un.`}
                      </p>
                    </td>
                    <td className="px-4 py-4 align-top">
                      {item.firstShortageOn ? (
                        <>
                          <p>Ruptura: {date(item.firstShortageOn)}</p>
                          <p className="text-xs font-medium text-destructive">
                            Comprar até {date(item.suggestedOrderBy!)}
                          </p>
                        </>
                      ) : (
                        <span className="text-muted-foreground">Sem ruptura prevista</span>
                      )}
                    </td>
                    <td className="px-5 py-4 align-top">
                      <p>{item.supplierName ?? "Não vinculado"}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.catalogCode ?? item.presentationName ?? "Sem item de catálogo"}
                      </p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-10 text-center text-sm text-muted-foreground">
            <ShoppingCart className="mx-auto mb-3 size-8" aria-hidden="true" />
            Nenhuma aplicação prevista neste período.
          </div>
        )}
      </section>
    </div>
  );
}
