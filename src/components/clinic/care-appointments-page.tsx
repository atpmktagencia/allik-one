import { Link } from "@tanstack/react-router";
import { useDeferredValue, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
  Search,
  XCircle,
} from "lucide-react";
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
    internalCode: string;
  }>;
  professionals: Array<{
    id: string;
    name: string;
    profession: string | null;
    professionalCouncil: string | null;
    councilNumber: string | null;
    councilRegion: string | null;
    unitId: string | null;
  }>;
  units: Array<{ id: string; name: string }>;
  careTypes: Array<{ code: string; name: string }>;
  rooms: Array<{ id: string; unitId: string; name: string }>;
  resources: Array<{ id: string; unitId: string; roomId: string; name: string }>;
  canManage: boolean;
};
type AppointmentForm = {
  unitId: string;
  patientId: string;
  professionalUserId: string;
  careType: string;
  date: string;
  startsAt: string;
  endsAt: string;
  room: string;
  resourceName: string;
  notes: string;
  reason: string;
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
const draftKey = "allik_appointment_draft_v1";
const dateValue = (value: string) =>
  new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "America/Fortaleza",
  }).format(new Date(value));
const timeValue = (value: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "America/Fortaleza",
  }).format(new Date(value));
const blankAppointmentForm = (): AppointmentForm => ({
  unitId: "",
  patientId: "",
  professionalUserId: "",
  careType: "CONSULTATION",
  date: localDate(new Date()),
  startsAt: "08:00",
  endsAt: "09:00",
  room: "",
  resourceName: "",
  notes: "",
  reason: "Criação ou atualização operacional do agendamento.",
});

export function CareAppointmentsPage({ preselectedPatientId }: { preselectedPatientId?: string }) {
  const [view, setView] = useState<View>("week");
  const [focus, setFocus] = useState(() => new Date());
  const range = rangeFor(view, focus);
  const [professionalFilter, setProfessionalFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Appointment | null>(null);
  const [patientSearch, setPatientSearch] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [form, setForm] = useState<AppointmentForm>(blankAppointmentForm);
  const deferredPatientSearch = useDeferredValue(patientSearch.trim());
  const searchedPatient = deferredPatientSearch.length >= 2 ? deferredPatientSearch : "";
  const selectedPatientId = form.patientId || preselectedPatientId || "";
  const resource = `care-appointments?from=${encodeURIComponent(range.from.toISOString())}&to=${encodeURIComponent(range.to.toISOString())}${professionalFilter ? `&professionalId=${encodeURIComponent(professionalFilter)}` : ""}${statusFilter ? `&status=${encodeURIComponent(statusFilter)}` : ""}${searchedPatient ? `&patientSearch=${encodeURIComponent(searchedPatient)}` : ""}${selectedPatientId ? `&patientId=${encodeURIComponent(selectedPatientId)}` : ""}`;
  const query = useInventory<Payload>(resource);
  const restoredPatient = useRef(false);
  const patients = useMemo(() => {
    const available = (query.data?.patients ?? []).filter(
      (patient) => !form.unitId || patient.unitId === form.unitId,
    );
    if (!editing || available.some((patient) => patient.id === editing.patientId)) return available;
    return [
      ...available,
      {
        id: editing.patientId,
        unitId: editing.unitId,
        fullName: editing.patientName,
        phone: editing.phone,
        internalCode: "",
      },
    ];
  }, [editing, form.unitId, query.data?.patients]);
  useEffect(() => {
    if (!preselectedPatientId || restoredPatient.current || !query.data) return;
    const patient = query.data.patients.find((item) => item.id === preselectedPatientId);
    if (!patient) return;
    restoredPatient.current = true;
    let draft: Partial<AppointmentForm> = {};
    try {
      draft = JSON.parse(sessionStorage.getItem(draftKey) ?? "{}") as Partial<AppointmentForm>;
    } catch {
      draft = {};
    }
    sessionStorage.removeItem(draftKey);
    const sameUnit = !draft.unitId || draft.unitId === patient.unitId;
    setForm({
      ...blankAppointmentForm(),
      ...draft,
      unitId: patient.unitId,
      patientId: patient.id,
      professionalUserId: sameUnit ? (draft.professionalUserId ?? "") : "",
      room: sameUnit ? (draft.room ?? "") : "",
      resourceName: sameUnit ? (draft.resourceName ?? "") : "",
    });
    setEditing(null);
    setOpen(true);
    setMessage("Paciente cadastrado e selecionado. Confira o agendamento.");
  }, [preselectedPatientId, query.data]);
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
    setForm({ ...blankAppointmentForm(), unitId });
    setEditing(null);
    setOpen(true);
    setError("");
    setMessage("");
  }
  function startEdit(item: Appointment) {
    setEditing(item);
    setForm({
      unitId: item.unitId,
      patientId: item.patientId,
      professionalUserId: item.professionalUserId,
      careType: item.careType,
      date: dateValue(item.startsAt),
      startsAt: timeValue(item.startsAt),
      endsAt: timeValue(item.endsAt),
      room: item.room,
      resourceName: item.resourceName ?? (item.chair ? `Poltrona ${item.chair}` : ""),
      notes: item.notes,
      reason: "Atualização operacional conferida do agendamento.",
    });
    setPatientSearch("");
    setError("");
    setMessage("");
    setOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const startsAt = new Date(`${form.date}T${form.startsAt}:00-03:00`).toISOString();
    const endsAt = new Date(`${form.date}T${form.endsAt}:00-03:00`).toISOString();
    try {
      const response = await fetch("/api/v1/inventory/care-appointments", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: editing ? "UPDATE" : "CREATE",
          id: editing?.id ?? crypto.randomUUID(),
          unitId: form.unitId,
          patientId: form.patientId,
          professionalUserId: form.professionalUserId,
          careType: form.careType,
          otherCareType: null,
          startsAt,
          endsAt,
          room: form.room,
          chair: null,
          resourceName: form.resourceName || null,
          notes: form.notes,
          status: editing?.status ?? "SCHEDULED",
          version: editing?.version ?? 0,
          reason: form.reason,
        }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Não foi possível agendar.");
      await query.refetch();
      setOpen(false);
      setEditing(null);
      setMessage(
        editing ? "Agendamento atualizado e auditado." : "Atendimento agendado e auditado.",
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha de conexão.");
    } finally {
      setPending(false);
    }
  }
  async function updateStatus(item: Appointment, status: Appointment["status"]) {
    const destructive = status === "CANCELED" || status === "COMPLETED";
    if (
      destructive &&
      !window.confirm(`Confirmar: ${statuses[status]?.toLocaleLowerCase("pt-BR")}?`)
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
          ...item,
          status,
          otherCareType: item.otherCareType,
          chair: item.chair,
          reason: `Situação alterada de ${statuses[item.status] ?? item.status} para ${statuses[status] ?? status}.`,
        }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(result.error ?? "Não foi possível atualizar o atendimento.");
      await query.refetch();
      setMessage(`Atendimento marcado como ${statuses[status]?.toLocaleLowerCase("pt-BR")}.`);
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
        {formatTime(item.startsAt)}–{formatTime(item.endsAt)} ·{" "}
        <Link
          to="/pacientes/$patientId"
          params={{ patientId: item.patientId }}
          className="text-primary underline-offset-4 hover:underline"
        >
          {item.patientName}
        </Link>
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
      {data.canManage ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {!["COMPLETED", "NO_SHOW", "CANCELED"].includes(item.status) ? (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => startEdit(item)}>
              <Pencil className="mr-1.5 size-3.5" /> Abrir/editar
            </Button>
          ) : null}
          {item.status === "SCHEDULED" ? (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => updateStatus(item, "CONFIRMED")}
            >
              Confirmar
            </Button>
          ) : null}
          {["SCHEDULED", "CONFIRMED"].includes(item.status) ? (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => updateStatus(item, "IN_PROGRESS")}
            >
              Iniciar
            </Button>
          ) : null}
          {item.status === "IN_PROGRESS" ? (
            <Button size="sm" disabled={pending} onClick={() => updateStatus(item, "COMPLETED")}>
              <CheckCircle2 className="mr-1.5 size-3.5" /> Concluir
            </Button>
          ) : null}
          {["SCHEDULED", "CONFIRMED"].includes(item.status) ? (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => updateStatus(item, "NO_SHOW")}
            >
              Não compareceu
            </Button>
          ) : null}
          {!["COMPLETED", "NO_SHOW", "CANCELED"].includes(item.status) ? (
            <Button
              size="sm"
              variant="destructive"
              disabled={pending}
              onClick={() => updateStatus(item, "CANCELED")}
            >
              <XCircle className="mr-1.5 size-3.5" /> Cancelar
            </Button>
          ) : null}
        </div>
      ) : null}
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
            <h2 className="font-semibold">
              {editing ? "Editar ou remarcar atendimento" : "Novo agendamento"}
            </h2>
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
                    room: "",
                    resourceName: "",
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
                      {p.professionalCouncil && p.councilNumber && p.councilRegion
                        ? ` · ${p.professionalCouncil} ${p.councilNumber}/${p.councilRegion}`
                        : ""}
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
                maxLength={100}
                value={patientSearch}
                onChange={(e) => setPatientSearch(e.target.value)}
              />
              <span className="block text-xs font-normal text-muted-foreground">
                {patientSearch.trim().length === 1
                  ? "Digite pelo menos 2 caracteres."
                  : query.isFetching
                    ? "Buscando…"
                    : "A busca consulta a base da unidade selecionada."}
              </span>
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
              {!editing ? (
                <Button asChild type="button" variant="link" className="h-auto px-0 text-xs">
                  <Link
                    to="/pacientes"
                    search={{ create: true, returnTo: "/agenda" }}
                    onClick={() => sessionStorage.setItem(draftKey, JSON.stringify(form))}
                  >
                    Cadastrar novo paciente sem perder este agendamento
                  </Link>
                </Button>
              ) : null}
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
                onChange={(e) => setForm({ ...form, room: e.target.value, resourceName: "" })}
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
                value={form.resourceName}
                onChange={(e) => setForm({ ...form, resourceName: e.target.value })}
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
            <label className="space-y-1 text-sm font-medium md:col-span-2 xl:col-span-3">
              Motivo do cadastro ou alteração
              <Input
                required
                minLength={10}
                maxLength={500}
                value={form.reason}
                onChange={(event) => setForm({ ...form, reason: event.target.value })}
              />
            </label>
          </div>
          <div className="flex gap-3">
            <Button disabled={pending}>
              {pending ? "Salvando…" : editing ? "Salvar alterações" : "Agendar"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => {
                setOpen(false);
                setEditing(null);
              }}
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
      <section className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2">
        <label className="space-y-1 text-sm font-medium">
          Filtrar por profissional
          <select
            className="h-10 w-full rounded-md border bg-background px-3 font-normal"
            value={professionalFilter}
            onChange={(event) => setProfessionalFilter(event.target.value)}
          >
            <option value="">Todos os profissionais</option>
            {Array.from(new Map(data.professionals.map((item) => [item.id, item])).values()).map(
              (professional) => (
                <option key={professional.id} value={professional.id}>
                  {professional.name}
                </option>
              ),
            )}
          </select>
        </label>
        <label className="space-y-1 text-sm font-medium">
          Filtrar por situação
          <select
            className="h-10 w-full rounded-md border bg-background px-3 font-normal"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="">Todas as situações</option>
            {Object.entries(statuses).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
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
