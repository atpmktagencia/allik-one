import { useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { readInventoryResponse, useInventory } from "@/data/inventory-api";
import { InventoryState } from "./inventory-state";

const kinds = {
  RETURN: "Agendar retorno",
  EXAMS: "Acompanhar exames",
  CONTACT: "Contatar paciente",
  DOCUMENT: "Preparar documento",
  OTHER: "Outra tarefa",
};
const states = {
  OPEN: "Pendente",
  IN_PROGRESS: "Em andamento",
  DONE: "Concluída",
  CANCELED: "Cancelada",
};
type Task = {
  id: string;
  patientId: string;
  patientName: string;
  unitId: string;
  appointmentId: string | null;
  kind: keyof typeof kinds;
  title: string;
  instructions: string;
  dueOn: string;
  assigneeUserId: string | null;
  assigneeName: string | null;
  status: keyof typeof states;
  resolution: string;
  version: number;
  overdue: boolean;
};
type Payload = {
  tasks: Task[];
  context?: { patientId: string; unitId: string; patientName: string } | null;
  units: { id: string; name: string }[];
  assignees: { id: string; name: string; role: string; unitId: string | null }[];
  canManage: boolean;
  hasMore: boolean;
  userId: string | null;
};
const blank = {
  patientId: "",
  kind: "RETURN" as keyof typeof kinds,
  title: "Agendar retorno",
  instructions: "",
  dueOn: "",
  assigneeUserId: "",
  reason: "",
};
const selectClass = "h-10 w-full rounded-md border bg-background px-3 text-sm";

export function CareTasksPanel({
  patientId,
  appointmentId,
  returnOn,
  unitId,
}: {
  patientId?: string;
  appointmentId?: string;
  returnOn?: string;
  unitId?: string;
}) {
  const client = useQueryClient();
  const [state, setState] = useState("PENDING"),
    [mine, setMine] = useState(false),
    [overdue, setOverdue] = useState(false),
    [offset, setOffset] = useState(0);
  const params = new URLSearchParams({
    state,
    mine: String(mine),
    overdue: String(overdue),
    offset: String(offset),
  });
  if (patientId) params.set("patientId", patientId);
  if (appointmentId) params.set("appointmentId", appointmentId);
  const query = useInventory<Payload>(`care-tasks?${params}`);
  const [operationId, setOperationId] = useState("");
  const [form, setForm] = useState({ ...blank, patientId: patientId ?? "" }),
    [showForm, setShowForm] = useState(false),
    [editing, setEditing] = useState<Task | null>(null);
  const [statusTask, setStatusTask] = useState<Task | null>(null),
    [nextStatus, setNextStatus] = useState<keyof typeof states>("DONE"),
    [reason, setReason] = useState("");
  const [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const patients = useInventory<{
    patients: { id: string; fullName: string; primaryUnitId?: string; unitId?: string }[];
  }>("patients", { enabled: showForm && !patientId && !editing });
  async function save(body: unknown) {
    setPending(true);
    setError("");
    setMessage("");
    try {
      await readInventoryResponse(
        await fetch("/api/v1/inventory/care-tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify(body),
        }),
      );
      setShowForm(false);
      setEditing(null);
      setStatusTask(null);
      setMessage("Tarefa registrada.");
      await client.invalidateQueries({ queryKey: ["inventory"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setPending(false);
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    void save({
      action: editing ? "UPDATE" : "CREATE",
      id: editing?.id ?? operationId,
      patientId: form.patientId,
      appointmentId: appointmentId ?? null,
      kind: form.kind,
      title: form.title,
      instructions: form.instructions,
      dueOn: form.dueOn,
      assigneeUserId: form.assigneeUserId || null,
      ...(editing ? { version: editing.version, reason: form.reason } : {}),
    });
  }
  if (!query.data) return <InventoryState pending={query.isLoading} error={query.error} />;
  const data = query.data;
  const currentUnit =
    editing?.unitId ??
    unitId ??
    data.context?.unitId ??
    patients.data?.patients.find((p) => p.id === form.patientId)?.primaryUnitId ??
    patients.data?.patients.find((p) => p.id === form.patientId)?.unitId;
  const assignees = data.assignees
    .filter((p) => p.role === "SUPER_ADMIN" || p.unitId === currentUnit)
    .filter((p, i, a) => a.findIndex((x) => x.id === p.id) === i);
  return (
    <section className="space-y-4 rounded-lg border bg-card p-4" aria-label="Tarefas da equipe">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Tarefas da equipe</h2>
          <p className="text-sm text-muted-foreground">
            Acompanhe os próximos passos até a conclusão.
          </p>
        </div>
        {data.canManage && (
          <Button
            disabled={pending}
            onClick={() => {
              setEditing(null);
              setOperationId(crypto.randomUUID());
              setForm({ ...blank, patientId: patientId ?? "", dueOn: returnOn ?? "" });
              setShowForm(true);
              setError("");
            }}
          >
            Nova tarefa
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      {!data.canManage && (
        <p className="text-sm text-muted-foreground">
          Use uma conta individual com permissão de gestão de pacientes para alterar tarefas.
        </p>
      )}
      {showForm && (
        <form onSubmit={submit} className="space-y-3 rounded-md border p-4">
          <h3 className="font-medium">{editing ? "Editar tarefa" : "Nova tarefa"}</h3>
          {!patientId && !editing && (
            <label className="block text-sm">
              Paciente
              <select
                className={selectClass}
                value={form.patientId}
                required
                onChange={(e) =>
                  setForm({ ...form, patientId: e.target.value, assigneeUserId: "" })
                }
              >
                <option value="">Selecione um paciente</option>
                {patients.data?.patients
                  .filter((p) => (p as { active?: boolean }).active !== false)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.fullName}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {patients.error && (
            <p role="alert" className="text-sm text-destructive">
              Não foi possível carregar os pacientes. Atualize a página.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              Tipo
              <select
                className={selectClass}
                value={form.kind}
                onChange={(e) => {
                  const kind = e.target.value as keyof typeof kinds;
                  setForm({ ...form, kind, title: kinds[kind] });
                }}
              >
                {Object.entries(kinds).map(([v, l]) => (
                  <option value={v} key={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Prazo
              <Input
                type="date"
                required
                value={form.dueOn}
                onChange={(e) => setForm({ ...form, dueOn: e.target.value })}
              />
            </label>
          </div>
          <label className="block text-sm">
            Título
            <Input
              required
              minLength={3}
              maxLength={160}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </label>
          <label className="block text-sm">
            Responsável
            <select
              className={selectClass}
              value={form.assigneeUserId}
              onChange={(e) => setForm({ ...form, assigneeUserId: e.target.value })}
            >
              <option value="">Equipe — sem responsável definido</option>
              {assignees.map((p) => (
                <option value={p.id} key={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Orientação operacional
            <Textarea
              maxLength={1000}
              value={form.instructions}
              onChange={(e) => setForm({ ...form, instructions: e.target.value })}
              placeholder="Ex.: entrar em contato para combinar o agendamento."
            />
          </label>
          <p className="text-xs text-muted-foreground">
            Registre apenas o necessário para a equipe executar a tarefa. Mantenha diagnósticos e
            detalhes clínicos no prontuário.
          </p>
          {editing && (
            <label className="block text-sm">
              Motivo da alteração
              <Input
                required
                minLength={3}
                maxLength={500}
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
              />
            </label>
          )}
          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando…" : "Salvar tarefa"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setShowForm(false)}
            >
              Fechar
            </Button>
          </div>
        </form>
      )}
      <div className="flex flex-wrap items-center gap-4">
        <label className="text-sm">
          Situação
          <select
            className={selectClass}
            value={state}
            onChange={(e) => {
              setState(e.target.value);
              setOffset(0);
            }}
          >
            <option value="PENDING">Todas as pendências</option>
            {Object.entries(states).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
            <option value="ALL">Todas as tarefas</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={mine}
            onChange={(e) => {
              setMine(e.target.checked);
              setOffset(0);
            }}
          />
          Minhas tarefas
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={overdue}
            onChange={(e) => {
              setOverdue(e.target.checked);
              setOffset(0);
            }}
          />
          Somente atrasadas
        </label>
        <Button variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>
          Atualizar
        </Button>
      </div>
      {query.error && (
        <p role="alert" className="text-destructive">
          Não foi possível atualizar a lista.
        </p>
      )}
      {data.tasks.length === 0 ? (
        <p className="py-6 text-sm text-muted-foreground">Nenhuma tarefa para estes filtros.</p>
      ) : (
        <ul className="space-y-3">
          {data.tasks.map((t) => (
            <li key={t.id} className="space-y-2 rounded-md border p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="font-medium">{t.title}</h3>
                  <Link
                    className="text-sm text-primary underline"
                    to="/pacientes/$patientId"
                    params={{ patientId: t.patientId }}
                  >
                    {t.patientName}
                  </Link>
                </div>
                <span className={t.overdue ? "text-sm font-medium text-destructive" : "text-sm"}>
                  {states[t.status]}
                  {t.overdue ? " · Atrasada" : ""}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                Prazo: {t.dueOn.split("-").reverse().join("/")} ·{" "}
                {t.assigneeName ?? "Equipe — sem responsável"} · {kinds[t.kind]}
              </p>
              {t.instructions && <p className="whitespace-pre-wrap text-sm">{t.instructions}</p>}
              {t.resolution && (
                <p className="whitespace-pre-wrap text-sm">Resultado: {t.resolution}</p>
              )}
              <TaskHistory taskId={t.id} />
              {data.canManage && (
                <div className="flex flex-wrap gap-2">
                  {["OPEN", "IN_PROGRESS"].includes(t.status) ? (
                    <>
                      {t.status === "OPEN" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={() => {
                            setStatusTask(t);
                            setNextStatus("IN_PROGRESS");
                            setReason("");
                          }}
                        >
                          Iniciar
                        </Button>
                      )}
                      <Button
                        size="sm"
                        disabled={pending}
                        onClick={() => {
                          setStatusTask(t);
                          setNextStatus("DONE");
                          setReason("");
                        }}
                      >
                        Concluir
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => {
                          setEditing(t);
                          setForm({
                            ...blank,
                            patientId: t.patientId,
                            kind: t.kind,
                            title: t.title,
                            instructions: t.instructions,
                            dueOn: t.dueOn,
                            assigneeUserId: t.assigneeUserId ?? "",
                          });
                          setShowForm(true);
                        }}
                      >
                        Editar
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => {
                          setStatusTask(t);
                          setNextStatus("CANCELED");
                          setReason("");
                        }}
                      >
                        Cancelar tarefa
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => {
                        setStatusTask(t);
                        setNextStatus("OPEN");
                        setReason("");
                      }}
                    >
                      Reabrir
                    </Button>
                  )}
                </div>
              )}
              {statusTask?.id === t.id && (
                <form
                  className="space-y-2 rounded-md bg-muted p-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void save({
                      action: "STATUS",
                      id: t.id,
                      version: t.version,
                      status: nextStatus,
                      reason,
                    });
                  }}
                >
                  <label className="block text-sm">
                    {states[nextStatus]} — resultado ou motivo
                    <Textarea
                      autoFocus
                      required
                      minLength={3}
                      maxLength={500}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </label>
                  <div className="flex gap-2">
                    <Button type="submit" size="sm" disabled={pending}>
                      Confirmar
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => setStatusTask(null)}
                    >
                      Voltar
                    </Button>
                  </div>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          disabled={offset === 0 || query.isFetching}
          onClick={() => setOffset(Math.max(0, offset - 50))}
        >
          Anterior
        </Button>
        <span className="text-sm">Página {Math.floor(offset / 50) + 1}</span>
        <Button
          variant="outline"
          disabled={!data.hasMore || query.isFetching}
          onClick={() => setOffset(offset + 50)}
        >
          Próxima
        </Button>
      </div>
    </section>
  );
}

function TaskHistory({ taskId }: { taskId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(!open)}>
        {open ? "Ocultar histórico" : "Ver histórico"}
      </Button>
      {open && <TaskHistoryEntries taskId={taskId} />}
    </div>
  );
}
function TaskHistoryEntries({ taskId }: { taskId: string }) {
  const [offset, setOffset] = useState(0);
  const query = useInventory<{
    events: {
      id: string;
      createdAt: string;
      actorName: string;
      reason: string;
      status: keyof typeof states;
      version: string;
    }[];
    hasMore: boolean;
  }>(`care-tasks?historyFor=${taskId}&offset=${offset}`);
  if (!query.data) return <InventoryState pending={query.isLoading} error={query.error} />;
  return (
    <div className="space-y-2 py-3">
      <ol className="space-y-2 text-sm">
        {query.data.events.map((e) => (
          <li key={e.id}>
            {new Date(e.createdAt).toLocaleString("pt-BR")} · {e.actorName} · {states[e.status]} ·{" "}
            {e.reason}
          </li>
        ))}
      </ol>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={offset === 0 || query.isFetching}
          onClick={() => setOffset(Math.max(0, offset - 50))}
        >
          Mais recentes
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!query.data.hasMore || query.isFetching}
          onClick={() => setOffset(offset + 50)}
        >
          Mais antigos
        </Button>
      </div>
    </div>
  );
}
