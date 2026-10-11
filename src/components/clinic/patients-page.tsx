import { useDeferredValue, useMemo, useState, type FormEvent } from "react";
import { Pencil, Plus, Search, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useInventory } from "@/data/inventory-api";
import { InventoryState } from "./inventory-state";
import { PageHeader } from "./page-kit";

type ConsentStatus = "PENDING" | "RECORDED" | "REVOKED";
type Patient = {
  id: string;
  primaryUnitId: string;
  unitName: string;
  internalCode: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  active: boolean;
  consentStatus: ConsentStatus;
  version: number;
};
type Payload = {
  patients: Patient[];
  units: Array<{ id: string; name: string }>;
  canManage: boolean;
};
type PatientForm = {
  primaryUnitId: string;
  internalCode: string;
  fullName: string;
  phone: string;
  email: string;
  active: boolean;
  consentStatus: ConsentStatus;
  reason: string;
};

const blankForm: PatientForm = {
  primaryUnitId: "",
  internalCode: "",
  fullName: "",
  phone: "",
  email: "",
  active: true,
  consentStatus: "PENDING",
  reason: "Cadastro operacional inicial do paciente.",
};

const consentLabels: Record<ConsentStatus, string> = {
  PENDING: "Pendente",
  RECORDED: "Registrado",
  REVOKED: "Revogado",
};

export function PatientsPage() {
  const query = useInventory<Payload>("patients");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [editing, setEditing] = useState<Patient | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<PatientForm>(blankForm);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const patientList = query.data?.patients;
  const filteredPatients = useMemo(() => {
    const patients = patientList ?? [];
    const term = deferredSearch.trim().toLocaleLowerCase("pt-BR");
    if (!term) return patients;
    return patients.filter((patient) =>
      [patient.fullName, patient.internalCode, patient.phone, patient.email, patient.unitName]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase("pt-BR").includes(term)),
    );
  }, [deferredSearch, patientList]);

  if (query.isPending || query.error)
    return (
      <InventoryState pending={query.isPending} error={query.error} retry={() => query.refetch()} />
    );

  const data = query.data!;
  const patients = data.patients;
  function startCreate() {
    setEditing(null);
    setForm({
      ...blankForm,
      primaryUnitId: data.units.length === 1 ? data.units[0]!.id : "",
    });
    setError("");
    setMessage("");
    setFormOpen(true);
  }
  function startEdit(patient: Patient) {
    setEditing(patient);
    setForm({
      primaryUnitId: patient.primaryUnitId,
      internalCode: patient.internalCode,
      fullName: patient.fullName,
      phone: patient.phone ?? "",
      email: patient.email ?? "",
      active: patient.active,
      consentStatus: patient.consentStatus,
      reason: "Atualização conferida do cadastro operacional.",
    });
    setError("");
    setMessage("");
    setFormOpen(true);
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/v1/inventory/patients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          action: editing ? "UPDATE" : "CREATE",
          id: editing?.id ?? crypto.randomUUID(),
          ...form,
          phone: form.phone || null,
          email: form.email || null,
          version: editing?.version ?? 0,
        }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Não foi possível salvar o paciente.");
      await query.refetch();
      setMessage(editing ? "Cadastro atualizado e auditado." : "Paciente cadastrado e auditado.");
      setFormOpen(false);
      setEditing(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha de conexão.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Atendimento"
        title="Pacientes"
        description="Cadastro operacional mínimo e separado por unidade. Tratamentos, prescrições e reservas serão adicionados na próxima etapa."
        action={
          data.canManage ? (
            <Button onClick={startCreate}>
              <Plus className="mr-2 size-4" /> Novo paciente
            </Button>
          ) : undefined
        }
      />

      <div className="rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning-foreground">
        Não registre diagnóstico, receita ou informação clínica em nome, código ou contato. Esta
        etapa contém apenas identificação operacional.
      </div>

      {(message || error) && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${error ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-success/30 bg-success-soft text-success-foreground"}`}
          role={error ? "alert" : "status"}
        >
          {error || message}
        </div>
      )}

      {formOpen && data.canManage && (
        <form onSubmit={save} className="space-y-5 rounded-xl border bg-card p-5 shadow-soft">
          <div>
            <h2 className="font-display text-lg font-semibold">
              {editing ? "Editar paciente" : "Cadastrar paciente"}
            </h2>
            <p className="text-sm text-muted-foreground">
              Campos clínicos e documentos não fazem parte deste formulário.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <label className="space-y-1.5 text-sm font-medium">
              Unidade principal
              <select
                className="h-10 w-full rounded-md border bg-background px-3 font-normal"
                required
                value={form.primaryUnitId}
                onChange={(event) => setForm({ ...form, primaryUnitId: event.target.value })}
              >
                <option value="">Selecione a unidade</option>
                {data.units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              Código interno
              <Input
                required
                minLength={3}
                maxLength={40}
                pattern="[A-Za-z0-9._-]+"
                placeholder="Ex.: PAC-0001"
                value={form.internalCode}
                onChange={(event) => setForm({ ...form, internalCode: event.target.value })}
              />
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              Nome completo
              <Input
                required
                minLength={3}
                maxLength={180}
                autoComplete="name"
                value={form.fullName}
                onChange={(event) => setForm({ ...form, fullName: event.target.value })}
              />
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              Telefone (opcional)
              <Input
                type="tel"
                autoComplete="tel"
                value={form.phone}
                onChange={(event) => setForm({ ...form, phone: event.target.value })}
              />
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              E-mail (opcional)
              <Input
                type="email"
                autoComplete="email"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
              />
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              Consentimento cadastral
              <select
                className="h-10 w-full rounded-md border bg-background px-3 font-normal"
                value={form.consentStatus}
                onChange={(event) =>
                  setForm({ ...form, consentStatus: event.target.value as ConsentStatus })
                }
              >
                <option value="PENDING">Pendente</option>
                <option value="RECORDED">Registrado</option>
                <option value="REVOKED">Revogado</option>
              </select>
            </label>
            <label className="space-y-1.5 text-sm font-medium md:col-span-2">
              Motivo da alteração
              <Input
                required
                minLength={10}
                maxLength={500}
                value={form.reason}
                onChange={(event) => setForm({ ...form, reason: event.target.value })}
              />
            </label>
            <label className="flex items-center gap-2 self-end pb-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(event) => setForm({ ...form, active: event.target.checked })}
              />
              Paciente ativo
            </label>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando…" : editing ? "Salvar alterações" : "Cadastrar paciente"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setFormOpen(false)}
            >
              Cancelar
            </Button>
          </div>
        </form>
      )}

      <section className="rounded-xl border bg-card shadow-soft">
        <div className="flex flex-col gap-3 border-b p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display font-semibold">Cadastros autorizados</h2>
            <p className="text-sm text-muted-foreground">
              {patients.length}{" "}
              {patients.length === 1 ? "paciente no escopo atual" : "pacientes no escopo atual"}
            </p>
          </div>
          <label className="relative block sm:w-80">
            <span className="sr-only">Buscar paciente</span>
            <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
            <Input
              className="pl-9"
              type="search"
              placeholder="Buscar por nome, código ou contato"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </div>
        {filteredPatients.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 font-medium">Paciente</th>
                  <th className="px-5 py-3 font-medium">Unidade</th>
                  <th className="px-5 py-3 font-medium">Contato</th>
                  <th className="px-5 py-3 font-medium">Consentimento</th>
                  <th className="px-5 py-3 font-medium">Situação</th>
                  {data.canManage && <th className="px-5 py-3 text-right font-medium">Ação</th>}
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredPatients.map((patient) => (
                  <tr key={patient.id}>
                    <td className="px-5 py-4">
                      <p className="font-medium">{patient.fullName}</p>
                      <p className="text-xs text-muted-foreground">{patient.internalCode}</p>
                    </td>
                    <td className="px-5 py-4">{patient.unitName}</td>
                    <td className="px-5 py-4 text-muted-foreground">
                      <p>{patient.phone ?? "—"}</p>
                      <p>{patient.email ?? "—"}</p>
                    </td>
                    <td className="px-5 py-4">{consentLabels[patient.consentStatus]}</td>
                    <td className="px-5 py-4">
                      <Badge variant={patient.active ? "default" : "secondary"}>
                        {patient.active ? "Ativo" : "Inativo"}
                      </Badge>
                    </td>
                    {data.canManage && (
                      <td className="px-5 py-4 text-right">
                        <Button variant="outline" size="sm" onClick={() => startEdit(patient)}>
                          <Pencil className="mr-2 size-3.5" /> Editar
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex min-h-56 flex-col items-center justify-center p-8 text-center">
            <UserRound className="mb-3 size-9 text-muted-foreground" />
            <p className="font-medium">
              {search ? "Nenhum resultado" : "Nenhum paciente cadastrado"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {search
                ? "Tente outro nome, código ou contato."
                : "O cadastro começa vazio e não recebe dados sintéticos."}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
