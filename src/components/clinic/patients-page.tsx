import { useDeferredValue, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
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
  phone2: string | null;
  email: string | null;
  documentType: "CPF" | "PASSPORT" | null;
  documentNumber: string | null;
  noDocument: boolean;
  birthDate: string | null;
  insurance: { name?: string; plan?: string; memberNumber?: string; validUntil?: string };
  additional: Record<string, string>;
  privateData: { allergies?: string[]; vegan?: boolean | null; notes?: string };
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
  phone2: string;
  email: string;
  documentType: "CPF" | "PASSPORT";
  documentNumber: string;
  noDocument: boolean;
  birthDate: string;
  insuranceName: string;
  insurancePlan: string;
  insuranceMemberNumber: string;
  insuranceValidUntil: string;
  rg: string;
  profession: string;
  motherName: string;
  fatherName: string;
  zipCode: string;
  address: string;
  complement: string;
  district: string;
  state: string;
  city: string;
  allergies: string;
  vegan: "" | "yes" | "no";
  privateNotes: string;
  active: boolean;
  consentStatus: ConsentStatus;
  reason: string;
};

const blankForm: PatientForm = {
  primaryUnitId: "",
  internalCode: "Gerado automaticamente",
  fullName: "",
  phone: "",
  phone2: "",
  email: "",
  documentType: "CPF",
  documentNumber: "",
  noDocument: false,
  birthDate: "",
  insuranceName: "",
  insurancePlan: "",
  insuranceMemberNumber: "",
  insuranceValidUntil: "",
  rg: "",
  profession: "",
  motherName: "",
  fatherName: "",
  zipCode: "",
  address: "",
  complement: "",
  district: "",
  state: "",
  city: "",
  allergies: "",
  vegan: "",
  privateNotes: "",
  active: true,
  consentStatus: "PENDING",
  reason: "Cadastro operacional inicial do paciente.",
};

const consentLabels: Record<ConsentStatus, string> = {
  PENDING: "Pendente",
  RECORDED: "Registrado",
  REVOKED: "Revogado",
};

export function PatientsPage({
  autoCreate = false,
  returnTo,
}: {
  autoCreate?: boolean;
  returnTo?: "/agenda";
}) {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const resource =
    deferredSearch.trim().length >= 2
      ? `patients?search=${encodeURIComponent(deferredSearch.trim())}`
      : "patients";
  const query = useInventory<Payload>(resource);
  const navigate = useNavigate();
  const autoCreateStarted = useRef(false);
  const [editing, setEditing] = useState<Patient | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [form, setForm] = useState<PatientForm>(blankForm);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!autoCreate || autoCreateStarted.current || !query.data?.canManage) return;
    autoCreateStarted.current = true;
    setEditing(null);
    setForm({
      ...blankForm,
      primaryUnitId: query.data.units.length === 1 ? query.data.units[0]!.id : "",
    });
    setFormOpen(true);
    setPhoto(null);
  }, [autoCreate, query.data]);
  const patientList = query.data?.patients;
  const filteredPatients = useMemo(() => {
    const patients = patientList ?? [];
    const term = deferredSearch.trim().toLocaleLowerCase("pt-BR");
    if (!term) return patients;
    return patients.filter((patient) =>
      [
        patient.fullName,
        patient.internalCode,
        patient.documentNumber,
        patient.phone,
        patient.email,
        patient.unitName,
      ]
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
    setPhoto(null);
  }
  function startEdit(patient: Patient) {
    setEditing(patient);
    setForm({
      primaryUnitId: patient.primaryUnitId,
      internalCode: patient.internalCode,
      fullName: patient.fullName,
      phone: patient.phone ?? "",
      phone2: patient.phone2 ?? "",
      email: patient.email ?? "",
      documentType: patient.documentType ?? "CPF",
      documentNumber: patient.documentNumber ?? "",
      noDocument: patient.noDocument,
      birthDate: patient.birthDate ?? "",
      insuranceName: patient.insurance.name ?? "",
      insurancePlan: patient.insurance.plan ?? "",
      insuranceMemberNumber: patient.insurance.memberNumber ?? "",
      insuranceValidUntil: patient.insurance.validUntil ?? "",
      rg: patient.additional["rg"] ?? "",
      profession: patient.additional["profession"] ?? "",
      motherName: patient.additional["motherName"] ?? "",
      fatherName: patient.additional["fatherName"] ?? "",
      zipCode: patient.additional["zipCode"] ?? "",
      address: patient.additional["address"] ?? "",
      complement: patient.additional["complement"] ?? "",
      district: patient.additional["district"] ?? "",
      state: patient.additional["state"] ?? "",
      city: patient.additional["city"] ?? "",
      allergies: (patient.privateData.allergies ?? []).join(", "),
      vegan:
        patient.privateData.vegan === true
          ? "yes"
          : patient.privateData.vegan === false
            ? "no"
            : "",
      privateNotes: patient.privateData.notes ?? "",
      active: patient.active,
      consentStatus: patient.consentStatus,
      reason: "Atualização conferida do cadastro operacional.",
    });
    setError("");
    setMessage("");
    setFormOpen(true);
    setPhoto(null);
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
          internalCode: editing?.internalCode ?? "",
          phone: form.phone || null,
          phone2: form.phone2 || null,
          email: form.email || null,
          documentType: form.noDocument ? null : form.documentType,
          documentNumber: form.noDocument ? null : form.documentNumber || null,
          noDocument: form.noDocument,
          birthDate: form.birthDate || null,
          insurance: {
            name: form.insuranceName,
            plan: form.insurancePlan,
            memberNumber: form.insuranceMemberNumber,
            validUntil: form.insuranceValidUntil,
          },
          additional: {
            rg: form.rg,
            profession: form.profession,
            motherName: form.motherName,
            fatherName: form.fatherName,
            zipCode: form.zipCode,
            address: form.address,
            complement: form.complement,
            district: form.district,
            state: form.state,
            city: form.city,
          },
          privateData: {
            allergies: form.allergies
              .split(/[,\n]/)
              .map((item) => item.trim())
              .filter(Boolean),
            vegan: form.vegan === "yes" ? true : form.vegan === "no" ? false : null,
            notes: form.privateNotes,
          },
          version: editing?.version ?? 0,
        }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Não foi possível salvar o paciente.");
      const savedId = editing?.id ?? String((result as { data?: { id?: string } }).data?.id ?? "");
      if (photo && savedId) {
        const photoData = new FormData();
        photoData.set("patientId", savedId);
        photoData.set("reason", "Atualização da foto de identificação do paciente.");
        photoData.set("photo", photo);
        const photoResponse = await fetch("/api/v1/inventory/patients", {
          method: "POST",
          credentials: "same-origin",
          body: photoData,
        });
        const photoResult = (await photoResponse.json()) as { error?: string };
        if (!photoResponse.ok)
          throw new Error(photoResult.error ?? "Paciente salvo, mas a foto não foi enviada.");
      }
      await query.refetch();
      setMessage(editing ? "Cadastro atualizado e auditado." : "Paciente cadastrado e auditado.");
      setFormOpen(false);
      setEditing(null);
      if (!editing && returnTo && savedId)
        await navigate({ to: returnTo, search: { patientId: savedId } });
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
        description="Cadastro operacional por unidade, com tratamentos, prescrições privadas e planejamento de demanda."
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
              Identificação, contato e dados privados com acesso restrito à unidade.
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
                readOnly
                value={editing ? form.internalCode : "Gerado automaticamente ao salvar"}
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
              Tipo de documento
              <select
                className="h-10 w-full rounded-md border bg-background px-3"
                disabled={form.noDocument}
                value={form.documentType}
                onChange={(event) =>
                  setForm({ ...form, documentType: event.target.value as "CPF" | "PASSPORT" })
                }
              >
                <option value="CPF">CPF</option>
                <option value="PASSPORT">Passaporte</option>
              </select>
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              Número do documento
              <Input
                disabled={form.noDocument}
                required={!form.noDocument}
                minLength={5}
                maxLength={30}
                value={form.documentNumber}
                onChange={(event) => setForm({ ...form, documentNumber: event.target.value })}
              />
            </label>
            <label className="flex items-center gap-2 self-end pb-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={form.noDocument}
                onChange={(event) =>
                  setForm({
                    ...form,
                    noDocument: event.target.checked,
                    documentNumber: event.target.checked ? "" : form.documentNumber,
                  })
                }
              />
              Não possui documento
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              Data de nascimento (opcional)
              <Input
                type="date"
                value={form.birthDate}
                onChange={(event) => setForm({ ...form, birthDate: event.target.value })}
              />
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              Telefone principal
              <Input
                required
                type="tel"
                autoComplete="tel"
                placeholder="+55 (99) 99999-9999"
                value={form.phone}
                onChange={(event) => setForm({ ...form, phone: event.target.value })}
              />
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              Telefone 2 (opcional)
              <Input
                type="tel"
                value={form.phone2}
                onChange={(event) => setForm({ ...form, phone2: event.target.value })}
              />
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              E-mail
              <Input
                required
                type="email"
                autoComplete="email"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
              />
            </label>
            <div className="md:col-span-2 xl:col-span-3 border-t pt-4">
              <h3 className="font-semibold">Convênio</h3>
            </div>
            <label className="space-y-1.5 text-sm font-medium">
              Convênio (vazio = não possui)
              <Input
                maxLength={100}
                value={form.insuranceName}
                onChange={(event) => setForm({ ...form, insuranceName: event.target.value })}
              />
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              Plano
              <Input
                maxLength={100}
                value={form.insurancePlan}
                onChange={(event) => setForm({ ...form, insurancePlan: event.target.value })}
              />
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              Nº de matrícula
              <Input
                maxLength={80}
                value={form.insuranceMemberNumber}
                onChange={(event) =>
                  setForm({ ...form, insuranceMemberNumber: event.target.value })
                }
              />
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              Validade do convênio
              <Input
                type="date"
                value={form.insuranceValidUntil}
                onChange={(event) => setForm({ ...form, insuranceValidUntil: event.target.value })}
              />
            </label>
            <div className="md:col-span-2 xl:col-span-3 border-t pt-4">
              <h3 className="font-semibold">Informações adicionais</h3>
            </div>
            <label className="space-y-1.5 text-sm font-medium md:col-span-2">
              Foto do paciente (opcional)
              <Input
                type="file"
                accept="image/jpeg,image/png,image/heic,image/heif"
                onChange={(event) => setPhoto(event.target.files?.[0] ?? null)}
              />
              <span className="block text-xs text-muted-foreground">
                JPG, PNG ou HEIC, até 5 MB. Armazenamento privado.
              </span>
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              RG
              <Input
                maxLength={30}
                value={form.rg}
                onChange={(event) => setForm({ ...form, rg: event.target.value })}
              />
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              Profissão
              <Input
                maxLength={100}
                value={form.profession}
                onChange={(event) => setForm({ ...form, profession: event.target.value })}
              />
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              Nome da mãe
              <Input
                maxLength={180}
                value={form.motherName}
                onChange={(event) => setForm({ ...form, motherName: event.target.value })}
              />
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              Nome do pai
              <Input
                maxLength={180}
                value={form.fatherName}
                onChange={(event) => setForm({ ...form, fatherName: event.target.value })}
              />
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              CEP
              <Input
                maxLength={12}
                value={form.zipCode}
                onChange={(event) => setForm({ ...form, zipCode: event.target.value })}
              />
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              Endereço
              <Input
                maxLength={180}
                value={form.address}
                onChange={(event) => setForm({ ...form, address: event.target.value })}
              />
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              Complemento
              <Input
                maxLength={100}
                value={form.complement}
                onChange={(event) => setForm({ ...form, complement: event.target.value })}
              />
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              Bairro
              <Input
                maxLength={100}
                value={form.district}
                onChange={(event) => setForm({ ...form, district: event.target.value })}
              />
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              Estado
              <Input
                maxLength={2}
                value={form.state}
                onChange={(event) => setForm({ ...form, state: event.target.value.toUpperCase() })}
              />
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              Cidade
              <Input
                maxLength={100}
                value={form.city}
                onChange={(event) => setForm({ ...form, city: event.target.value })}
              />
            </label>
            <div className="md:col-span-2 xl:col-span-3 border-t pt-4">
              <h3 className="font-semibold">Informações privadas</h3>
              <p className="text-xs text-muted-foreground">
                Não substituem anamnese ou prontuário.
              </p>
            </div>
            <label className="space-y-1.5 text-sm font-medium md:col-span-2">
              Alergias
              <Input
                maxLength={1000}
                placeholder="Separe por vírgula ou Enter"
                value={form.allergies}
                onChange={(event) => setForm({ ...form, allergies: event.target.value })}
              />
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              Vegano
              <select
                className="h-10 w-full rounded-md border bg-background px-3"
                value={form.vegan}
                onChange={(event) =>
                  setForm({ ...form, vegan: event.target.value as PatientForm["vegan"] })
                }
              >
                <option value="">Não informado</option>
                <option value="yes">Sim</option>
                <option value="no">Não</option>
              </select>
            </label>
            <label className="space-y-1.5 text-sm font-medium md:col-span-2 xl:col-span-3">
              Observações privadas
              <Input
                maxLength={2000}
                value={form.privateNotes}
                onChange={(event) => setForm({ ...form, privateNotes: event.target.value })}
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
              placeholder="Buscar por nome, CPF, código ou contato"
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
                      <Link
                        to="/pacientes/$patientId"
                        params={{ patientId: patient.id }}
                        className="font-medium text-primary underline-offset-4 hover:underline"
                      >
                        {patient.fullName}
                      </Link>
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
