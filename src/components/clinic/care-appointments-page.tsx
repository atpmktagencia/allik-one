import { Link } from "@tanstack/react-router";
import { useMemo, useState, type FormEvent } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useInventory } from "@/data/inventory-api";
import { InventoryState } from "./inventory-state";
import { PageHeader } from "./page-kit";

type View = "day" | "week" | "month" | "kanban";
type Appointment = {
  id: string;
  unitId: string;
  unitName: string;
  patientId: string;
  patientName: string;
  phone: string | null;
  professionalUserId: string;
  professionalName: string;
  careType: string;
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
  appointments: Appointment[];
  patients: Array<{
    id: string;
    unitId: string;
    fullName: string;
    phone: string | null;
    email: string | null;
    documentNumber: string | null;
    internalCode: string;
  }>;
  professionals: Array<{
    id: string;
    name: string;
    profession: string | null;
    unitId: string | null;
  }>;
  units: Array<{ id: string; name: string }>;
  careTypes: Array<{ code: string; name: string }>;
  rooms: Array<{ id: string; unitId: string; name: string }>;
  resources: Array<{ id: string; unitId: string; roomId: string; name: string }>;
  canManage: boolean;
};

const fallbackTypes: Record<string, string> = {
  FIRST_VISIT: "Primeira consulta",
  FOLLOW_UP: "Retorno",
  CONSULTATION: "Consulta",
  TELECONSULTATION: "Teleconsulta",
  INJECTABLE: "Injetável",
  HORMONAL_IMPLANT: "Implante hormonal",
  PROCEDURE: "Outro procedimento",
};
const statuses: Record<string, string> = {
  SCHEDULED: "Agendado",
  CONFIRMED: "Confirmado",
  IN_PROGRESS: "Em atendimento",
  COMPLETED: "Completado",
  NO_SHOW: "Não compareceu",
  CANCELED: "Cancelado",
};
const pad = (value: number) => String(value).padStart(2, "0");
const localDate = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
function rangeFor(view: View, focus: Date) {
  const from = startOfDay(focus);
  if (view === "week") from.setDate(from.getDate() - ((from.getDay() + 6) % 7));
  if (view === "month") from.setDate(1);
  const to = new Date(from);
  to.setDate(to.getDate() + (view === "month" ? 42 : view === "week" ? 7 : 1));
  return { from, to };
}
function formatTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Fortaleza",
  }).format(new Date(value));
}
function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Fortaleza",
  }).format(new Date(value));
}

export function CareAppointmentsPage() {
  const [view, setView] = useState<View>("week");
  const [focus, setFocus] = useState(() => new Date());
  const range = rangeFor(view, focus);
  const resource = `care-appointments?from=${encodeURIComponent(range.from.toISOString())}&to=${encodeURIComponent(range.to.toISOString())}`;
  const query = useInventory<Payload>(resource);
  const [open, setOpen] = useState(false);
  const [patientSearch, setPatientSearch] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    unitId: "",
    patientId: "",
    professionalUserId: "",
    careType: "CONSULTATION",
    otherCareType: "",
    date: localDate(new Date()),
    startsAt: "08:00",
    endsAt: "09:00",
    room: "",
    chair: "",
    notes: "",
    reason: "Criação de agendamento solicitada pelo paciente.",
  });
  const patients = useMemo(() => {
    const term = patientSearch.trim().toLocaleLowerCase("pt-BR");
    return (query.data?.patients ?? []).filter(
      (patient) =>
        (!form.unitId || patient.unitId === form.unitId) &&
        (!term ||
          [
            patient.fullName,
            patient.documentNumber,
            patient.phone,
            patient.email,
            patient.internalCode,
          ]
            .filter(Boolean)
            .some((value) => value!.toLocaleLowerCase("pt-BR").includes(term))),
    );
  }, [form.unitId, patientSearch, query.data?.patients]);
  if (query.isPending || query.error)
    return (
      <InventoryState pending={query.isPending} error={query.error} retry={() => query.refetch()} />
    );
  const data = query.data!;
  const today = localDate(new Date());
  const todayItems = data.appointments.filter(
    (item) => localDate(new Date(item.startsAt)) === today,
  );
  const kanban = {
    "Agendamentos do dia": todayItems.filter((item) =>
      ["SCHEDULED", "CONFIRMED"].includes(item.status),
    ),
    "Atendimentos completados no dia": todayItems.filter((item) => item.status === "COMPLETED"),
    "Atendimentos não finalizados": todayItems.filter((item) =>
      ["IN_PROGRESS", "NO_SHOW"].includes(item.status),
    ),
  };
  function startCreate() {
    const unitId = data.units.length === 1 ? data.units[0]!.id : "";
    setForm((current) => ({ ...current, unitId, patientId: "", professionalUserId: "" }));
    setOpen(true);
    setError("");
    setMessage("");
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const startsAt = new Date(`${form.date}T${form.startsAt}:00`).toISOString();
    const endsAt = new Date(`${form.date}T${form.endsAt}:00`).toISOString();
    try {
      const response = await fetch("/api/v1/inventory/care-appointments", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "CREATE",
          id: crypto.randomUUID(),
          unitId: form.unitId,
          patientId: form.patientId,
          professionalUserId: form.professionalUserId,
          careType: form.careType,
          otherCareType: null,
          startsAt,
          endsAt,
          room: form.room,
          chair: null,
          resourceName: form.chair || null,
          notes: form.notes,
          status: "SCHEDULED",
          version: 0,
          reason: form.reason,
        }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Não foi possível agendar.");
      await query.refetch();
      setOpen(false);
      setMessage("Atendimento agendado e auditado.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha de conexão.");
    } finally {
      setPending(false);
    }
  }
  function move(amount: number) {
    const next = new Date(focus);
    next.setDate(next.getDate() + amount * (view === "month" ? 28 : view === "week" ? 7 : 1));
    setFocus(next);
  }
  const card = (item: Appointment) => (
    <article key={item.id} className="rounded-lg border bg-card p-3 shadow-sm">
      <p className="font-medium">
        {formatTime(item.startsAt)}–{formatTime(item.endsAt)} · {item.patientName}
      </p>
      <p className="text-xs text-muted-foreground">
        {data.careTypes.find((type) => type.code === item.careType)?.name ??
          fallbackTypes[item.careType] ??
          item.otherCareType}{" "}
        · {item.professionalName}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {item.unitName} · {item.room}
        {item.resourceName
          ? ` · ${item.resourceName}`
          : item.chair
            ? ` · Poltrona ${item.chair}`
            : ""}
      </p>
      <span className="mt-2 inline-flex rounded-full bg-muted px-2 py-0.5 text-xs">
        {statuses[item.status] ?? item.status}
      </span>
    </article>
  );
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Atendimento"
        title="Agendamentos"
        description="Consultas, teleconsultas e procedimentos com escopo por unidade."
        action={
          data.canManage ? (
            <Button onClick={startCreate}>
              <Plus className="mr-2 size-4" />
              Novo agendamento
            </Button>
          ) : undefined
        }
      />
      {(message || error) && (
        <div
          role={error ? "alert" : "status"}
          className={`rounded-lg border px-4 py-3 text-sm ${error ? "text-destructive" : "text-success-foreground"}`}
        >
          {error || message}
        </div>
      )}
      {open && data.canManage && (
        <form onSubmit={save} className="space-y-5 rounded-xl border bg-card p-5">
          <div>
            <h2 className="font-semibold">Novo agendamento</h2>
            <p className="text-sm text-muted-foreground">
              Os horários são exibidos no fuso de Fortaleza.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <label className="space-y-1 text-sm font-medium">
              Unidade
              <select
                required
                className="h-10 w-full rounded-md border bg-background px-3"
                value={form.unitId}
                onChange={(e) =>
                  setForm({
                    ...form,
                    unitId: e.target.value,
                    patientId: "",
                    professionalUserId: "",
                  })
                }
              >
                <option value="">Selecione</option>
                {data.units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm font-medium">
              Tipo de atendimento
              <select
                className="h-10 w-full rounded-md border bg-background px-3"
                value={form.careType}
                onChange={(e) => setForm({ ...form, careType: e.target.value })}
              >
                {data.careTypes.map((type) => (
                  <option key={type.code} value={type.code}>
                    {type.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm font-medium">
              Profissional da saúde
              <select
                required
                className="h-10 w-full rounded-md border bg-background px-3"
                value={form.professionalUserId}
                onChange={(e) => setForm({ ...form, professionalUserId: e.target.value })}
              >
                <option value="">Selecione</option>
                {data.professionals
                  .filter((p) => !form.unitId || !p.unitId || p.unitId === form.unitId)
                  .map((p) => (
                    <option key={`${p.id}-${p.unitId}`} value={p.id}>
                      {p.name}
                      {p.profession ? ` · ${p.profession}` : ""}
                    </option>
                  ))}
              </select>
            </label>
            <label className="space-y-1 text-sm font-medium">
              Buscar paciente
              <Search className="sr-only" />
              <Input
                type="search"
                placeholder="Nome, CPF, telefone ou código"
                value={patientSearch}
                onChange={(e) => setPatientSearch(e.target.value)}
              />
            </label>
            <label className="space-y-1 text-sm font-medium">
              Paciente
              <select
                required
                className="h-10 w-full rounded-md border bg-background px-3"
                value={form.patientId}
                onChange={(e) => setForm({ ...form, patientId: e.target.value })}
              >
                <option value="">Selecione</option>
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.fullName} · {p.phone ?? p.internalCode}
                  </option>
                ))}
              </select>
              <Button asChild type="button" variant="link" className="h-auto px-0 text-xs">
                <Link to="/pacientes">Cadastrar novo paciente</Link>
              </Button>
            </label>
            <label className="space-y-1 text-sm font-medium">
              Data
              <Input
                required
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
            </label>
            <label className="space-y-1 text-sm font-medium">
              Horário inicial
              <Input
                required
                type="time"
                value={form.startsAt}
                onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
              />
            </label>
            <label className="space-y-1 text-sm font-medium">
              Horário final
              <Input
                required
                type="time"
                value={form.endsAt}
                onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
              />
            </label>
            <label className="space-y-1 text-sm font-medium">
              Sala de atendimento
              <select
                required
                className="h-10 w-full rounded-md border bg-background px-3"
                value={form.room}
                onChange={(e) => setForm({ ...form, room: e.target.value, chair: "" })}
              >
                <option value="">Selecione</option>
                {data.rooms
                  .filter((room) => !form.unitId || room.unitId === form.unitId)
                  .map((room) => (
                    <option key={room.id} value={room.name}>
                      {room.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="space-y-1 text-sm font-medium">
              Leito/Poltrona
              <select
                className="h-10 w-full rounded-md border bg-background px-3"
                value={form.chair}
                onChange={(e) => setForm({ ...form, chair: e.target.value })}
              >
                <option value="">Não se aplica</option>
                {data.resources
                  .filter(
                    (resource) =>
                      data.rooms.find((room) => room.id === resource.roomId)?.name === form.room,
                  )
                  .map((resource) => (
                    <option key={resource.id} value={resource.name}>
                      {resource.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="space-y-1 text-sm font-medium md:col-span-2">
              Observações
              <Input
                maxLength={1000}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </label>
          </div>
          <div className="flex gap-3">
            <Button disabled={pending}>{pending ? "Agendando…" : "Agendar"}</Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              Cancelar
            </Button>
          </div>
        </form>
      )}
      <section className="rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="icon"
              aria-label="Período anterior"
              onClick={() => move(-1)}
            >
              <ChevronLeft />
            </Button>
            <Button variant="outline" onClick={() => setFocus(new Date())}>
              Hoje
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="Próximo período"
              onClick={() => move(1)}
            >
              <ChevronRight />
            </Button>
          </div>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Visualização da agenda">
            {(["day", "week", "month", "kanban"] as View[]).map((item) => (
              <Button
                key={item}
                size="sm"
                variant={view === item ? "default" : "outline"}
                onClick={() => setView(item)}
              >
                {{ day: "Dia", week: "Semana", month: "Mês", kanban: "Kanban" }[item]}
              </Button>
            ))}
          </div>
        </div>
      </section>
      {view === "kanban" ? (
        <div className="grid gap-4 lg:grid-cols-3">
          {Object.entries(kanban).map(([title, items]) => (
            <section key={title} className="rounded-xl border bg-muted/20 p-4">
              <h2 className="mb-3 font-semibold">
                {title} <span className="text-muted-foreground">({items.length})</span>
              </h2>
              <div className="space-y-3">
                {items.length ? (
                  items.map(card)
                ) : (
                  <p className="text-sm text-muted-foreground">Nenhum atendimento.</p>
                )}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <section className="rounded-xl border bg-card">
          <div className="border-b p-5">
            <h2 className="font-semibold">
              <CalendarDays className="mr-2 inline size-4" />
              Agenda · {localDate(range.from)} a{" "}
              {localDate(new Date(range.to.getTime() - 86400000))}
            </h2>
          </div>
          <div className="divide-y">
            {data.appointments.length ? (
              data.appointments.map((item) => (
                <div key={item.id} className="grid gap-3 p-4 md:grid-cols-[100px_1fr]">
                  <p className="text-sm font-medium">{formatDate(item.startsAt)}</p>
                  {card(item)}
                </div>
              ))
            ) : (
              <p className="p-8 text-center text-sm text-muted-foreground">
                Nenhum atendimento neste período.
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
