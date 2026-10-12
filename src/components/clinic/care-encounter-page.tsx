import { Link } from "@tanstack/react-router";
import { ArrowLeft, CalendarClock, ClipboardList, History, UserRound } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useInventory } from "@/data/inventory-api";
import { InventoryState } from "./inventory-state";
import { PageHeader } from "./page-kit";

type Appointment = {
  id: string;
  unitId: string;
  unitName: string;
  patientId: string;
  patientName: string;
  patientCode: string;
  professionalUserId: string;
  professionalName: string;
  professionalCouncil: string | null;
  councilNumber: string | null;
  councilRegion: string | null;
  careType: string;
  careTypeName: string;
  otherCareType: string | null;
  startsAt: string;
  endsAt: string;
  room: string;
  chair: number | null;
  resourceName: string | null;
  notes: string;
  status: string;
  version: number;
};
type Payload = {
  appointment: Appointment;
  changes: Array<{ id: string; action: string; reason: string; actor: string; createdAt: string }>;
  treatments: Array<{
    id: string;
    productName: string;
    sku: string;
    doseQuantity: string;
    doseUnit: string;
    route: string;
    frequencyEveryDays: string;
    status: string;
  }>;
  schedule: Array<{
    id: string;
    scheduledOn: string;
    doseQuantity: string;
    doseUnit: string;
    status: string;
    productName: string;
  }>;
  canManage: boolean;
};

const statusLabels: Record<string, string> = {
  SCHEDULED: "Agendado",
  CONFIRMED: "Confirmado",
  IN_PROGRESS: "Em atendimento",
  COMPLETED: "Completado",
  NO_SHOW: "Não compareceu",
  CANCELED: "Cancelado",
};
const actionLabels: Record<string, string> = {
  CREATE: "Agendamento criado",
  UPDATE: "Agendamento atualizado",
  RESCHEDULE: "Atendimento remarcado",
  STATUS: "Situação atualizada",
};
const scheduleLabels: Record<string, string> = {
  PLANNED: "Planejada",
  RESERVED: "Reservada",
  CONSUMED: "Consumida",
  CANCELED: "Cancelada",
};
const dateTime = (value: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Fortaleza",
  }).format(new Date(value));

export function CareEncounterPage({ appointmentId }: { appointmentId: string }) {
  const query = useInventory<Payload>(`care-encounter?appointmentId=${appointmentId}`);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  if (query.isPending || query.error)
    return (
      <InventoryState pending={query.isPending} error={query.error} retry={() => query.refetch()} />
    );
  const data = query.data!;
  const appointment = data.appointment;

  async function updateStatus(status: string) {
    if (
      status === "COMPLETED" &&
      !window.confirm("Confirmar a conclusão deste atendimento? Esta situação encerra a operação.")
    )
      return;
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/v1/inventory/care-appointments", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "UPDATE_STATUS",
          ...appointment,
          status,
          chair: appointment.chair,
          otherCareType: appointment.otherCareType,
          reason: `Situação do atendimento alterada para ${statusLabels[status] ?? status}.`,
        }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Não foi possível atualizar.");
      await query.refetch();
      setMessage(`Atendimento marcado como ${statusLabels[status]?.toLocaleLowerCase("pt-BR")}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha de conexão.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-3">
        <Link to="/agenda">
          <ArrowLeft /> Voltar à agenda
        </Link>
      </Button>
      <PageHeader
        eyebrow={`${appointment.patientCode} · ${appointment.unitName}`}
        title={appointment.patientName}
        description={`${appointment.careTypeName} · ${dateTime(appointment.startsAt)}`}
        action={
          <Badge variant="outline">{statusLabels[appointment.status] ?? appointment.status}</Badge>
        }
      />
      {(message || error) && (
        <div role={error ? "alert" : "status"} className="rounded-lg border px-4 py-3 text-sm">
          {error || message}
        </div>
      )}
      {data.canManage && !["COMPLETED", "NO_SHOW", "CANCELED"].includes(appointment.status) ? (
        <section className="flex flex-wrap gap-2 rounded-xl border bg-card p-4">
          {appointment.status === "SCHEDULED" ? (
            <Button variant="outline" disabled={pending} onClick={() => updateStatus("CONFIRMED")}>
              Confirmar presença
            </Button>
          ) : null}
          {["SCHEDULED", "CONFIRMED"].includes(appointment.status) ? (
            <Button disabled={pending} onClick={() => updateStatus("IN_PROGRESS")}>
              Iniciar atendimento
            </Button>
          ) : null}
          {appointment.status === "IN_PROGRESS" ? (
            <Button disabled={pending} onClick={() => updateStatus("COMPLETED")}>
              Concluir atendimento
            </Button>
          ) : null}
        </section>
      ) : null}
      <div className="grid gap-5 xl:grid-cols-[1fr_.9fr]">
        <section className="space-y-4 rounded-xl border bg-card p-5">
          <h2 className="flex items-center gap-2 font-semibold">
            <CalendarClock className="size-4" /> Contexto do atendimento
          </h2>
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <Info label="Início" value={dateTime(appointment.startsAt)} />
            <Info label="Término previsto" value={dateTime(appointment.endsAt)} />
            <Info label="Profissional" value={appointment.professionalName} />
            <Info
              label="Registro profissional"
              value={
                appointment.professionalCouncil && appointment.councilNumber
                  ? `${appointment.professionalCouncil} ${appointment.councilNumber}/${appointment.councilRegion}`
                  : "Não informado"
              }
            />
            <Info label="Sala" value={appointment.room} />
            <Info label="Leito/Poltrona" value={appointment.resourceName ?? "Não se aplica"} />
          </dl>
          <div>
            <p className="text-xs text-muted-foreground">Observações do agendamento</p>
            <p className="mt-1 whitespace-pre-wrap text-sm">
              {appointment.notes || "Nenhuma observação registrada."}
            </p>
          </div>
          <Button asChild variant="outline">
            <Link to="/pacientes/$patientId" params={{ patientId: appointment.patientId }}>
              <UserRound /> Abrir plano operacional do paciente
            </Link>
          </Button>
        </section>
        <section className="space-y-4 rounded-xl border bg-card p-5">
          <h2 className="flex items-center gap-2 font-semibold">
            <ClipboardList className="size-4" /> Tratamentos ativos
          </h2>
          {data.treatments.length ? (
            <div className="space-y-3">
              {data.treatments.map((item) => (
                <article key={item.id} className="rounded-lg border p-3 text-sm">
                  <p className="font-medium">{item.productName}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {item.doseQuantity} {item.doseUnit} · {item.route} · a cada{" "}
                    {item.frequencyEveryDays} dia(s)
                  </p>
                </article>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nenhum tratamento operacional cadastrado.
            </p>
          )}
          <p className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">
            Esta tela organiza o atendimento e o consumo. Evolução clínica, diagnóstico e assinatura
            ainda não são registrados aqui.
          </p>
        </section>
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <section className="space-y-4 rounded-xl border bg-card p-5">
          <h2 className="font-semibold">Aplicações próximas</h2>
          {data.schedule.length ? (
            data.schedule.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-3 border-b py-2 text-sm last:border-0"
              >
                <span>
                  {item.productName} · {item.doseQuantity} {item.doseUnit}
                </span>
                <span className="text-xs text-muted-foreground">
                  {item.scheduledOn.split("-").reverse().join("/")} ·{" "}
                  {scheduleLabels[item.status] ?? item.status}
                </span>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">Nenhuma aplicação no período.</p>
          )}
        </section>
        <section className="space-y-4 rounded-xl border bg-card p-5">
          <h2 className="flex items-center gap-2 font-semibold">
            <History className="size-4" /> Histórico do agendamento
          </h2>
          {data.changes.map((item) => (
            <div key={item.id} className="border-b pb-3 text-sm last:border-0">
              <p className="font-medium">{actionLabels[item.action] ?? item.action}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {dateTime(item.createdAt)} · {item.actor}
              </p>
              <p className="mt-1 text-xs">{item.reason}</p>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-medium">{value}</dd>
    </div>
  );
}
