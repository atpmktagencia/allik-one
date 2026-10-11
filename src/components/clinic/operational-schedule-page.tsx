import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { AlertTriangle, CalendarDays, CheckCircle2, Clock3, Syringe } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useInventory } from "@/data/inventory-api";
import { InventoryState } from "./inventory-state";
import { PageHeader } from "./page-kit";

type ScheduleItem = {
  id: string;
  patientId: string;
  unitName: string;
  patientName: string;
  internalCode: string;
  productName: string;
  sku: string;
  route: string;
  sequence: number;
  scheduledOn: string;
  doseQuantity: number;
  doseUnit: string;
  status: string;
  hasPrescription: boolean;
  presentationName: string | null;
  physicalUnits: number;
  openQuantity: number;
  availableDoseQuantity: number | null;
  cumulativeDemandQuantity: number;
  stockWarning: boolean;
  presentationMissing: boolean;
  overdue: boolean;
};
type Payload = {
  days: number;
  status: string;
  items: ScheduleItem[];
  summary: { total: number; today: number; overdue: number; stockWarnings: number };
};
const periods = [7, 14, 30] as const;
const quantityFormatter = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 6 });
const formatQuantity = (value: number) => quantityFormatter.format(value);
const formatDate = (value: string) => value.split("-").reverse().join("/");
const statusLabels: Record<string, string> = {
  PLANNED: "Planejada",
  RESERVED: "Reservada",
  CONSUMED: "Realizada",
  CANCELED: "Cancelada",
};

export function OperationalSchedulePage() {
  const [days, setDays] = useState<(typeof periods)[number]>(7);
  const [status, setStatus] = useState<"PENDING" | "ALL" | "CONSUMED">("PENDING");
  const query = useInventory<Payload>(`patient-schedule?days=${days}&status=${status}`);
  if (query.isPending || query.error)
    return (
      <InventoryState pending={query.isPending} error={query.error} retry={() => query.refetch()} />
    );
  const data = query.data!;
  const cards = [
    { label: "Na agenda", value: data.summary.total, icon: CalendarDays },
    { label: "Para hoje", value: data.summary.today, icon: Syringe },
    { label: "Atrasadas", value: data.summary.overdue, icon: Clock3 },
    { label: "Requerem atenção", value: data.summary.stockWarnings, icon: AlertTriangle },
  ];
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Tratamentos programados"
        title="Agenda operacional"
        description="Organiza as aplicações previstas e antecipa falta de apresentação, estoque ou receita vinculada."
      />
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-2" aria-label="Período da agenda">
          {periods.map((period) => (
            <Button
              key={period}
              type="button"
              size="sm"
              variant={days === period ? "default" : "outline"}
              aria-pressed={days === period}
              onClick={() => setDays(period)}
            >
              {period} dias
            </Button>
          ))}
        </div>
        <label className="ml-auto flex items-center gap-2 text-sm font-medium">
          Situação
          <select
            className="h-9 rounded-md border bg-background px-3"
            value={status}
            onChange={(event) => setStatus(event.target.value as typeof status)}
          >
            <option value="PENDING">Pendentes</option>
            <option value="CONSUMED">Realizadas</option>
            <option value="ALL">Todas</option>
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
      <section className="overflow-hidden rounded-xl border bg-card">
        {data.items.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1050px] text-left text-sm">
              <caption className="sr-only">
                Aplicações de pacientes por data, unidade, produto e cobertura de estoque
              </caption>
              <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-5 py-3">Data / situação</th>
                  <th className="px-4 py-3">Paciente</th>
                  <th className="px-4 py-3">Aplicação</th>
                  <th className="px-4 py-3">Cobertura</th>
                  <th className="px-5 py-3">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.items.map((item) => (
                  <tr key={item.id} className={item.overdue ? "bg-destructive/5" : undefined}>
                    <td className="px-5 py-4 align-top">
                      <p className="font-medium">{formatDate(item.scheduledOn)}</p>
                      <Badge
                        variant={
                          item.overdue
                            ? "destructive"
                            : item.status === "CONSUMED"
                              ? "outline"
                              : "secondary"
                        }
                      >
                        {item.overdue ? "Atrasada" : (statusLabels[item.status] ?? item.status)}
                      </Badge>
                      <p className="mt-1 text-xs text-muted-foreground">{item.unitName}</p>
                    </td>
                    <td className="px-4 py-4 align-top">
                      <Link
                        to="/pacientes/$patientId"
                        params={{ patientId: item.patientId }}
                        className="font-medium hover:text-primary"
                      >
                        {item.patientName}
                      </Link>
                      <p className="text-xs text-muted-foreground">{item.internalCode}</p>
                      {item.hasPrescription ? (
                        <p className="mt-1 text-xs text-success">
                          <CheckCircle2 className="mr-1 inline size-3" aria-hidden="true" />
                          Receita vinculada
                        </p>
                      ) : (
                        <p className="mt-1 text-xs text-warning-foreground">
                          <AlertTriangle className="mr-1 inline size-3" aria-hidden="true" />
                          Sem receita vinculada
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-4 align-top">
                      <p className="font-medium">{item.productName}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatQuantity(item.doseQuantity)} {item.doseUnit} · {item.route} ·
                        aplicação {item.sequence}
                      </p>
                      <p className="text-xs text-muted-foreground">{item.sku}</p>
                    </td>
                    <td className="px-4 py-4 align-top">
                      {item.presentationMissing ? (
                        <Badge variant="destructive">Sem apresentação</Badge>
                      ) : item.stockWarning ? (
                        <Badge variant="destructive">Estoque insuficiente</Badge>
                      ) : (
                        <Badge variant="outline">Cobertura disponível</Badge>
                      )}
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatQuantity(item.openQuantity)} {item.doseUnit} abertos ·{" "}
                        {formatQuantity(item.physicalUnits)} un. físicas
                      </p>
                    </td>
                    <td className="px-5 py-4 align-top">
                      <Button asChild size="sm" variant="outline">
                        <Link to="/pacientes/$patientId" params={{ patientId: item.patientId }}>
                          Abrir tratamento
                        </Link>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-10 text-center text-sm text-muted-foreground">
            <CalendarDays className="mx-auto mb-3 size-8" aria-hidden="true" />
            Nenhuma aplicação encontrada neste período.
          </div>
        )}
      </section>
    </div>
  );
}
