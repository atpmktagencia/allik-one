import { useState } from "react";
import { AlertTriangle, CalendarDays, PackageSearch, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useInventory } from "@/data/inventory-api";
import { InventoryState } from "./inventory-state";
import { PageHeader } from "./page-kit";

type DemandItem = {
  unitId: string;
  unitName: string;
  productId: string;
  productName: string;
  sku: string;
  doseUnit: string;
  administrations: number;
  patients: number;
  plannedQuantity: number;
  reservedQuantity: number;
  demandQuantity: number;
  firstScheduledOn: string;
  lastScheduledOn: string;
  presentationName: string | null;
  usablePerPresentation: number | null;
  doseVolumeMl: number | null;
  minimumMeasurableVolumeMl: number | null;
  beyondUseHours: number | null;
  measurementWarning: boolean;
  requiredStockUnits: number | null;
  availableStockUnits: number;
  shortageStockUnits: number | null;
};
type Payload = {
  horizon: number;
  generatedOn: string;
  items: DemandItem[];
  summary: {
    administrations: number;
    patients: number;
    products: number;
    itemsWithShortage: number;
    itemsWithoutPresentation: number;
  };
};

const horizons = [7, 30, 60, 90] as const;
const date = (value: string) => value.slice(0, 10).split("-").reverse().join("/");
const quantityFormatter = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 6 });
const quantity = (value: number) => quantityFormatter.format(value);

export function PatientDemandPage() {
  const [horizon, setHorizon] = useState<(typeof horizons)[number]>(30);
  const query = useInventory<Payload>(`patient-demand?horizon=${horizon}`);
  if (query.isPending || query.error)
    return (
      <InventoryState pending={query.isPending} error={query.error} retry={() => query.refetch()} />
    );
  const data = query.data!;
  const cards = [
    { label: "Aplicações previstas", value: data.summary.administrations, icon: CalendarDays },
    { label: "Pacientes agendados", value: data.summary.patients, icon: Users },
    { label: "Produtos por unidade", value: data.summary.products, icon: PackageSearch },
    { label: "Déficits identificados", value: data.summary.itemsWithShortage, icon: AlertTriangle },
  ];
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Planejamento operacional"
        title="Demanda futura"
        description="Consolida doses planejadas e reservadas e compara a necessidade com o estoque disponível da unidade."
      />
      <div className="flex flex-wrap gap-2" aria-label="Período da previsão">
        {horizons.map((days) => (
          <Button
            key={days}
            type="button"
            size="sm"
            variant={horizon === days ? "default" : "outline"}
            aria-pressed={horizon === days}
            onClick={() => setHorizon(days)}
          >
            {days} dias
          </Button>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="rounded-xl border bg-card p-5 shadow-soft">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">{card.label}</p>
              <card.icon className="size-4 text-primary" aria-hidden="true" />
            </div>
            <p className="mt-2 font-display text-2xl font-semibold">{card.value}</p>
          </div>
        ))}
      </div>
      {data.summary.itemsWithoutPresentation > 0 && (
        <div className="rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning-foreground">
          {data.summary.itemsWithoutPresentation} item(ns) ainda não possuem apresentação e
          concentração vinculadas. A demanda em dose é exibida, mas a necessidade de ampolas não
          pode ser calculada com segurança.
        </div>
      )}
      <section className="overflow-hidden rounded-xl border bg-card">
        <div className="border-b p-5">
          <h2 className="font-semibold">Necessidade por produto e unidade</h2>
          <p className="text-sm text-muted-foreground">
            Período: hoje até os próximos {data.horizon} dias. Lotes vencidos ou bloqueados não
            entram no estoque disponível.
          </p>
        </div>
        {data.items.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-5 py-3">Unidade / produto</th>
                  <th className="px-4 py-3">Agenda</th>
                  <th className="px-4 py-3">Demanda</th>
                  <th className="px-4 py-3">Apresentação</th>
                  <th className="px-4 py-3">Estoque</th>
                  <th className="px-5 py-3">Cobertura</th>
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
                        {item.patients} paciente(s) · {date(item.firstScheduledOn)} a{" "}
                        {date(item.lastScheduledOn)}
                      </p>
                    </td>
                    <td className="px-4 py-4 align-top">
                      <p className="font-medium">
                        {quantity(item.demandQuantity)} {item.doseUnit}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {quantity(item.reservedQuantity)} reservada ·{" "}
                        {quantity(item.plannedQuantity)} planejada
                      </p>
                    </td>
                    <td className="px-4 py-4 align-top">
                      {item.presentationName ? (
                        <>
                          <p>{item.presentationName}</p>
                          <p className="text-xs text-muted-foreground">
                            {quantity(item.usablePerPresentation ?? 0)} {item.doseUnit} úteis/un.
                          </p>
                          {item.beyondUseHours ? (
                            <p className="text-xs text-muted-foreground">
                              Uso após abertura: {item.beyondUseHours} h
                            </p>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-muted-foreground">Não vinculada</span>
                      )}
                    </td>
                    <td className="px-4 py-4 align-top">
                      <p>{quantity(item.availableStockUnits)} un. disponíveis</p>
                      <p className="text-xs text-muted-foreground">
                        {item.requiredStockUnits === null
                          ? "Necessidade não calculada"
                          : `${item.requiredStockUnits} un. necessárias`}
                      </p>
                    </td>
                    <td className="px-5 py-4 align-top">
                      {item.shortageStockUnits === null ? (
                        <Badge variant="outline">Revisar cadastro</Badge>
                      ) : item.shortageStockUnits > 0 ? (
                        <Badge variant="destructive">Faltam {item.shortageStockUnits} un.</Badge>
                      ) : (
                        <Badge>Estoque suficiente</Badge>
                      )}
                      {item.measurementWarning ? (
                        <p className="mt-2 max-w-48 text-xs text-destructive">
                          Volume por dose ({quantity(item.doseVolumeMl ?? 0)} mL) abaixo do mínimo
                          mensurável ({quantity(item.minimumMeasurableVolumeMl ?? 0)} mL).
                        </p>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="p-10 text-center text-sm text-muted-foreground">
            Nenhuma aplicação planejada ou reservada neste período.
          </p>
        )}
      </section>
      <p className="text-xs text-muted-foreground">
        Esta previsão é operacional e calcula apresentações conservadoramente por dia de aplicação,
        sem carregar automaticamente sobras entre datas. Reserva não representa baixa física; o
        consumo será registrado somente na aplicação.
      </p>
    </div>
  );
}
