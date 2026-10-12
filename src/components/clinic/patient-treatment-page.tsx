import { Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { AlertTriangle, ArrowLeft, FileText, Plus, Stethoscope } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useInventory } from "@/data/inventory-api";
import { InventoryState } from "./inventory-state";
import { PageHeader } from "./page-kit";

type Treatment = {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  doseQuantity: string;
  doseUnit: string;
  route: string;
  frequencyEveryDays: string;
  firstScheduledOn: string;
  plannedAdministrations: number | null;
  status: string;
  version: number;
};
type Payload = {
  patient: {
    id: string;
    fullName: string;
    internalCode: string;
    unitName: string;
    active: boolean;
  };
  treatments: Treatment[];
  prescriptions: Array<{
    id: string;
    treatmentId: string;
    originalFilename: string;
    contentType: string;
    sizeBytes: number;
    uploadedAt: string;
    prescriberName: string | null;
    councilNumber: string | null;
    councilRegion: string | null;
    issuedOn: string | null;
    validUntil: string | null;
    documentStatus: "ACTIVE" | "SUPERSEDED" | "REVOKED";
    effectiveStatus:
      "VALID" | "EXPIRED" | "NOT_YET_VALID" | "SUPERSEDED" | "REVOKED" | "LEGACY_REVIEW";
    version: number;
    supersedesId: string | null;
  }>;
  products: Array<{ id: string; name: string; sku: string; unit: string }>;
  purchases: Array<{
    id: string;
    treatmentId: string;
    purchasedQuantity: string;
    quantityUnit: string;
    totalValue: string | null;
    reference: string;
    purchasedOn: string;
  }>;
  schedule: Array<{
    id: string;
    treatmentId: string;
    sequence: number;
    scheduledOn: string;
    doseQuantity: string;
    doseUnit: string;
    status: string;
    version: number;
    hasValidPrescription: boolean;
    applicationId: string | null;
    applicationReference: string | null;
    applicationProfessional: string | null;
    applicationRoute: string | null;
    applicationDoseVolumeMl: string | null;
    applicationOccurrenceNotes: string | null;
    applicationPrescriptionId: string | null;
    physicalQuantity: string | null;
    administeredAt: string | null;
  }>;
  locations: Array<{ id: string; name: string }>;
  supplySummaries: Array<{
    treatmentId: string;
    purchasedQuantity: number;
    reservedQuantity: number;
    consumedQuantity: number;
    plannedQuantity: number;
    purchasedRemaining: number;
    purchasedAvailableToReserve: number;
    presentationName: string | null;
    doseVolumeMl: number | null;
    usablePerPresentation: number | null;
    availableStockUnits: number;
    openQuantity: number;
    physicalAvailableDose: number | null;
    physicalUnreservedDose: number | null;
    requiredPresentationUnits: number | null;
    shortageUnits: number | null;
    unitDemandQuantity: number;
    unitReservedQuantity: number;
    unitRequiredPresentationUnits: number | null;
    unitShortageUnits: number | null;
  }>;
  clinicalHistory: Array<{
    id: string;
    appointmentId: string;
    evolution: string;
    conduct: string;
    diagnosticHypotheses: string;
    clinicalPlan: string;
    returnRecommendation: string;
    returnOn: string | null;
    chiefComplaint: string;
    currentHistory: string;
    personalHistory: string;
    familyHistory: string;
    habits: string;
    systemsReview: string;
    generalExam: string;
    cardiovascularExam: string;
    respiratoryExam: string;
    abdominalExam: string;
    neurologicalExam: string;
    musculoskeletalExam: string;
    skinExam: string;
    otherExam: string;
    authorName: string;
    professionalCouncil: string;
    councilNumber: string;
    councilRegion: string;
    systolicPressure: number | null;
    diastolicPressure: number | null;
    heartRate: number | null;
    oxygenSaturation: string | null;
    temperatureC: string | null;
    weightKg: string | null;
    heightCm: string | null;
    finalizedAt: string;
    appointmentStartsAt: string;
    careTypeName: string;
  }>;
  clinicalProblems: Array<{
    id: string;
    description: string;
    icd10Code: string | null;
    onsetOn: string | null;
    resolvedOn: string | null;
    status: "ACTIVE" | "RESOLVED" | "INACTIVE";
    notes: string;
    authorName: string;
    professionalCouncil: string;
    councilNumber: string;
    councilRegion: string;
    version: number;
    updatedAt: string;
  }>;
  clinicalAlerts: Array<{
    id: string;
    type: "ALLERGY" | "WARNING" | "PRECAUTION";
    title: string;
    reaction: string | null;
    severity: "UNKNOWN" | "MILD" | "MODERATE" | "SEVERE";
    status: "ACTIVE" | "INACTIVE";
    notes: string;
    authorName: string;
    professionalCouncil: string;
    councilNumber: string;
    councilRegion: string;
    version: number;
  }>;
  canManageClinicalProblems: boolean;
  canManage: boolean;
  canConsume: boolean;
};
const blank = {
  productId: "",
  doseQuantity: "",
  doseUnit: "MG",
  route: "IM",
  frequencyEveryDays: "7",
  firstScheduledOn: "",
  plannedAdministrations: "",
  status: "PLANNED",
  reason: "Cadastro inicial do tratamento prescrito.",
};
const statusLabels: Record<string, string> = {
  PLANNED: "Planejado",
  ACTIVE: "Ativo",
  PAUSED: "Pausado",
  COMPLETED: "Concluído",
  CANCELED: "Cancelado",
};
const scheduleLabels: Record<string, string> = {
  PLANNED: "Planejada",
  RESERVED: "Reservada",
  CONSUMED: "Consumida",
  CANCELED: "Cancelada",
};
const prescriptionLabels: Record<string, string> = {
  VALID: "Válida",
  EXPIRED: "Vencida",
  NOT_YET_VALID: "Ainda não vigente",
  SUPERSEDED: "Substituída",
  REVOKED: "Revogada",
  LEGACY_REVIEW: "Metadados pendentes",
};
const alertTypeLabels: Record<string, string> = {
  ALLERGY: "Alergia",
  WARNING: "Alerta",
  PRECAUTION: "Precaução",
};
const alertSeverityLabels: Record<string, string> = {
  UNKNOWN: "Gravidade não informada",
  MILD: "Leve",
  MODERATE: "Moderada",
  SEVERE: "Grave",
};
const blankProblem = {
  id: "",
  description: "",
  icd10Code: "",
  onsetOn: "",
  resolvedOn: "",
  status: "ACTIVE" as "ACTIVE" | "RESOLVED" | "INACTIVE",
  notes: "",
  reason: "Registro clínico incluído após avaliação profissional.",
  version: 0,
};
const blankAlert = {
  id: "",
  type: "ALLERGY" as "ALLERGY" | "WARNING" | "PRECAUTION",
  title: "",
  reaction: "",
  severity: "UNKNOWN" as "UNKNOWN" | "MILD" | "MODERATE" | "SEVERE",
  status: "ACTIVE" as "ACTIVE" | "INACTIVE",
  notes: "",
  reason: "Alerta incluído após avaliação profissional.",
  version: 0,
};

export function PatientTreatmentPage({ patientId }: { patientId: string }) {
  const query = useInventory<Payload>(`patient-detail?patientId=${patientId}`);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(blank);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [problemFormOpen, setProblemFormOpen] = useState(false);
  const [problem, setProblem] = useState(blankProblem);
  const [alertFormOpen, setAlertFormOpen] = useState(false);
  const [clinicalAlert, setClinicalAlert] = useState(blankAlert);
  const [purchase, setPurchase] = useState({
    treatmentId: "",
    purchasedQuantity: "",
    totalValue: "",
    reference: "",
    purchasedOn: "",
    reason: "Registro da quantidade adquirida pelo paciente.",
  });
  const [application, setApplication] = useState({
    operationId: "",
    scheduleId: "",
    scheduleVersion: 0,
    locationId: "",
    reference: "",
    professional: "",
    administeredDoseQuantity: 0,
    doseUnit: "",
    route: "",
    doseVolumeMl: null as number | null,
    occurrenceNotes: "",
    reason: "Aplicação realizada conforme programação e conferência operacional.",
    confirmed: false,
  });
  if (query.isPending || query.error)
    return (
      <InventoryState pending={query.isPending} error={query.error} retry={() => query.refetch()} />
    );
  const data = query.data!;
  const clinicalHistory = data.clinicalHistory ?? [];
  const clinicalProblems = data.clinicalProblems ?? [];
  const clinicalAlerts = data.clinicalAlerts ?? [];
  async function saveClinicalAlert(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/v1/inventory/clinical-alerts", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: clinicalAlert.id ? "UPDATE" : "CREATE",
          ...clinicalAlert,
          id: clinicalAlert.id || crypto.randomUUID(),
          patientId,
          reaction: clinicalAlert.reaction || null,
        }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Não foi possível salvar o alerta.");
      await query.refetch();
      setClinicalAlert(blankAlert);
      setAlertFormOpen(false);
      setMessage("Alerta clínico salvo com auditoria.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha de conexão.");
    } finally {
      setPending(false);
    }
  }

  function editClinicalAlert(item: Payload["clinicalAlerts"][number]) {
    setClinicalAlert({
      id: item.id,
      type: item.type,
      title: item.title,
      reaction: item.reaction ?? "",
      severity: item.severity,
      status: item.status,
      notes: item.notes,
      reason: "Correção ou atualização justificada do alerta clínico.",
      version: item.version,
    });
    setAlertFormOpen(true);
  }
  async function saveClinicalProblem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/v1/inventory/clinical-problems", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: problem.id ? "UPDATE" : "CREATE",
          ...problem,
          id: problem.id || crypto.randomUUID(),
          patientId,
          icd10Code: problem.icd10Code || null,
          onsetOn: problem.onsetOn || null,
          resolvedOn: problem.resolvedOn || null,
        }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Não foi possível salvar o registro.");
      await query.refetch();
      setProblem(blankProblem);
      setProblemFormOpen(false);
      setMessage("Problema ou antecedente clínico salvo com auditoria.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha de conexão.");
    } finally {
      setPending(false);
    }
  }

  function editClinicalProblem(item: Payload["clinicalProblems"][number]) {
    setProblem({
      id: item.id,
      description: item.description,
      icd10Code: item.icd10Code ?? "",
      onsetOn: item.onsetOn ?? "",
      resolvedOn: item.resolvedOn ?? "",
      status: item.status,
      notes: item.notes,
      reason: "Correção ou atualização justificada do registro clínico.",
      version: item.version,
    });
    setProblemFormOpen(true);
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/v1/inventory/patient-detail?patientId=${patientId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          action: "CREATE_TREATMENT",
          id: crypto.randomUUID(),
          patientId,
          ...form,
          doseQuantity: Number(form.doseQuantity),
          frequencyEveryDays: Number(form.frequencyEveryDays),
          plannedAdministrations: form.plannedAdministrations
            ? Number(form.plannedAdministrations)
            : null,
          version: 0,
        }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Não foi possível salvar.");
      await query.refetch();
      setForm(blank);
      setOpen(false);
      setMessage("Tratamento cadastrado e auditado.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha de conexão.");
    } finally {
      setPending(false);
    }
  }
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const body = new FormData(event.currentTarget);
    try {
      const response = await fetch(`/api/v1/inventory/patient-detail?patientId=${patientId}`, {
        method: "POST",
        body,
        credentials: "same-origin",
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Não foi possível enviar.");
      await query.refetch();
      event.currentTarget.reset();
      setMessage("Prescrição armazenada de forma privada.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha de conexão.");
    } finally {
      setPending(false);
    }
  }
  async function writeSupply(body: unknown, success: string) {
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/v1/inventory/patient-detail?patientId=${patientId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Não foi possível salvar.");
      await query.refetch();
      setMessage(success);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha de conexão.");
      return false;
    } finally {
      setPending(false);
    }
  }
  async function savePurchase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const saved = await writeSupply(
      {
        action: "CREATE_PURCHASE",
        id: crypto.randomUUID(),
        patientId,
        ...purchase,
        purchasedQuantity: Number(purchase.purchasedQuantity),
        totalValue: purchase.totalValue ? Number(purchase.totalValue) : null,
      },
      "Compra do paciente registrada e auditada.",
    );
    if (saved) setPurchase({ ...purchase, purchasedQuantity: "", totalValue: "", reference: "" });
  }
  async function updateSchedule(
    item: Payload["schedule"][number],
    status: "PLANNED" | "RESERVED" | "CANCELED",
  ) {
    await writeSupply(
      {
        action: "UPDATE_SCHEDULE_STATUS",
        patientId,
        scheduleId: item.id,
        status,
        version: item.version,
        reason:
          status === "RESERVED"
            ? "Dose reservada para a aplicação programada."
            : status === "PLANNED"
              ? "Reserva liberada e aplicação mantida no planejamento."
              : "Aplicação prevista cancelada com justificativa operacional.",
      },
      status === "RESERVED"
        ? "Dose reservada sem movimentar o estoque físico."
        : "Planejamento atualizado e auditado.",
    );
  }
  function startApplication(item: Payload["schedule"][number]) {
    const treatment = data.treatments.find((candidate) => candidate.id === item.treatmentId);
    const supply = data.supplySummaries.find(
      (candidate) => candidate.treatmentId === item.treatmentId,
    );
    setError("");
    setMessage("");
    setApplication({
      operationId: crypto.randomUUID(),
      scheduleId: item.id,
      scheduleVersion: item.version,
      locationId: data.locations.length === 1 ? data.locations[0]!.id : "",
      reference: `APL-${data.patient.internalCode}-${String(item.scheduledOn).slice(0, 10).replaceAll("-", "")}-${item.sequence}`,
      professional: "",
      administeredDoseQuantity: Number(item.doseQuantity),
      doseUnit: item.doseUnit,
      route: treatment?.route ?? "",
      doseVolumeMl: supply?.doseVolumeMl ?? null,
      occurrenceNotes: "",
      reason: "Aplicação realizada conforme programação e conferência operacional.",
      confirmed: false,
    });
  }
  async function consumeSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!application.confirmed) return;
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/v1/inventory/patient-applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          operationId: application.operationId,
          patientId,
          scheduleId: application.scheduleId,
          scheduleVersion: application.scheduleVersion,
          locationId: application.locationId,
          reference: application.reference,
          professional: application.professional,
          administeredDoseQuantity: application.administeredDoseQuantity,
          route: application.route,
          occurrenceNotes: application.occurrenceNotes,
          reason: application.reason,
        }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Não foi possível registrar a aplicação.");
      await query.refetch();
      setApplication((current) => ({ ...current, operationId: "", scheduleId: "" }));
      setMessage("Aplicação concluída: agenda, lote e estoque físico foram atualizados juntos.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha de conexão.");
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="space-y-6">
      <Link
        to="/pacientes"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Voltar aos pacientes
      </Link>
      <PageHeader
        eyebrow={`${data.patient.internalCode} · ${data.patient.unitName}`}
        title={data.patient.fullName}
        description="Plano operacional de aplicações. Não substitui prontuário, avaliação clínica ou prescrição médica."
        action={
          data.canManage ? (
            <Button onClick={() => setOpen(true)}>
              <Plus className="mr-2 size-4" />
              Novo tratamento
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
      <section className="space-y-4 rounded-xl border border-warning bg-warning-soft p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-semibold text-warning-foreground">
              <AlertTriangle className="size-5" /> Alergias e alertas clínicos
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Alertas ativos ficam destacados também durante o atendimento.
            </p>
          </div>
          {data.canManageClinicalProblems ? (
            <Button
              variant="outline"
              onClick={() => {
                setClinicalAlert(blankAlert);
                setAlertFormOpen(true);
              }}
            >
              <Plus /> Adicionar alerta
            </Button>
          ) : null}
        </div>
        {alertFormOpen && data.canManageClinicalProblems ? (
          <form onSubmit={saveClinicalAlert} className="space-y-4 rounded-lg border bg-card p-4">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-1 text-sm font-medium">
                Tipo
                <select
                  className="h-10 w-full rounded-md border bg-background px-3"
                  value={clinicalAlert.type}
                  onChange={(event) =>
                    setClinicalAlert({
                      ...clinicalAlert,
                      type: event.target.value as typeof clinicalAlert.type,
                    })
                  }
                >
                  <option value="ALLERGY">Alergia</option>
                  <option value="WARNING">Alerta</option>
                  <option value="PRECAUTION">Precaução</option>
                </select>
              </label>
              <label className="space-y-1 text-sm font-medium">
                Gravidade
                <select
                  className="h-10 w-full rounded-md border bg-background px-3"
                  value={clinicalAlert.severity}
                  onChange={(event) =>
                    setClinicalAlert({
                      ...clinicalAlert,
                      severity: event.target.value as typeof clinicalAlert.severity,
                    })
                  }
                >
                  <option value="UNKNOWN">Não informada</option>
                  <option value="MILD">Leve</option>
                  <option value="MODERATE">Moderada</option>
                  <option value="SEVERE">Grave</option>
                </select>
              </label>
              <label className="space-y-1 text-sm font-medium md:col-span-2">
                Agente, alergia ou título do alerta
                <Input
                  required
                  minLength={2}
                  maxLength={200}
                  value={clinicalAlert.title}
                  onChange={(event) =>
                    setClinicalAlert({ ...clinicalAlert, title: event.target.value })
                  }
                />
              </label>
              <label className="space-y-1 text-sm font-medium">
                Reação conhecida (opcional)
                <Input
                  maxLength={500}
                  value={clinicalAlert.reaction}
                  onChange={(event) =>
                    setClinicalAlert({ ...clinicalAlert, reaction: event.target.value })
                  }
                />
              </label>
              <label className="space-y-1 text-sm font-medium">
                Situação
                <select
                  className="h-10 w-full rounded-md border bg-background px-3"
                  value={clinicalAlert.status}
                  onChange={(event) =>
                    setClinicalAlert({
                      ...clinicalAlert,
                      status: event.target.value as typeof clinicalAlert.status,
                    })
                  }
                >
                  <option value="ACTIVE">Ativo</option>
                  <option value="INACTIVE">Inativo</option>
                </select>
              </label>
              <label className="space-y-1 text-sm font-medium md:col-span-2">
                Observações
                <Textarea
                  maxLength={2000}
                  rows={3}
                  value={clinicalAlert.notes}
                  onChange={(event) =>
                    setClinicalAlert({ ...clinicalAlert, notes: event.target.value })
                  }
                />
              </label>
              <label className="space-y-1 text-sm font-medium md:col-span-2">
                Motivo da inclusão ou alteração
                <Input
                  required
                  minLength={10}
                  maxLength={500}
                  value={clinicalAlert.reason}
                  onChange={(event) =>
                    setClinicalAlert({ ...clinicalAlert, reason: event.target.value })
                  }
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button disabled={pending}>{pending ? "Salvando…" : "Salvar alerta"}</Button>
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => setAlertFormOpen(false)}
              >
                Cancelar
              </Button>
            </div>
          </form>
        ) : null}
        {clinicalAlerts.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {clinicalAlerts.map((item) => (
              <article
                key={item.id}
                className={`rounded-lg border p-4 ${item.status === "ACTIVE" ? "bg-card" : "opacity-60"}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{item.title}</p>
                      <Badge variant={item.severity === "SEVERE" ? "destructive" : "outline"}>
                        {alertSeverityLabels[item.severity]}
                      </Badge>
                      <Badge variant="secondary">{alertTypeLabels[item.type]}</Badge>
                      {item.status === "INACTIVE" ? <Badge variant="outline">Inativo</Badge> : null}
                    </div>
                    {item.reaction ? <p className="mt-2 text-sm">Reação: {item.reaction}</p> : null}
                    {item.notes ? (
                      <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                        {item.notes}
                      </p>
                    ) : null}
                    <p className="mt-2 text-xs text-muted-foreground">
                      {item.authorName} · {item.professionalCouncil} {item.councilNumber}/
                      {item.councilRegion}
                    </p>
                  </div>
                  {data.canManageClinicalProblems ? (
                    <Button variant="ghost" size="sm" onClick={() => editClinicalAlert(item)}>
                      Editar
                    </Button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="rounded-lg bg-card p-4 text-sm text-muted-foreground">
            Nenhuma alergia ou alerta clínico registrado.
          </p>
        )}
      </section>
      <section className="space-y-4 rounded-xl border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">Problemas e antecedentes clínicos</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Registros estruturados com CID-10 opcional, situação e autoria profissional.
            </p>
          </div>
          {data.canManageClinicalProblems ? (
            <Button
              variant="outline"
              onClick={() => {
                setProblem(blankProblem);
                setProblemFormOpen(true);
              }}
            >
              <Plus /> Adicionar registro
            </Button>
          ) : null}
        </div>
        {problemFormOpen && data.canManageClinicalProblems ? (
          <form onSubmit={saveClinicalProblem} className="space-y-4 rounded-lg border p-4">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-1 text-sm font-medium md:col-span-2">
                Problema ou antecedente
                <Input
                  required
                  minLength={3}
                  maxLength={300}
                  value={problem.description}
                  onChange={(event) => setProblem({ ...problem, description: event.target.value })}
                />
              </label>
              <label className="space-y-1 text-sm font-medium">
                CID-10 (opcional)
                <Input
                  maxLength={8}
                  placeholder="Ex.: E11.9"
                  value={problem.icd10Code}
                  onChange={(event) =>
                    setProblem({ ...problem, icd10Code: event.target.value.toUpperCase() })
                  }
                />
              </label>
              <label className="space-y-1 text-sm font-medium">
                Situação
                <select
                  className="h-10 w-full rounded-md border bg-background px-3"
                  value={problem.status}
                  onChange={(event) =>
                    setProblem({ ...problem, status: event.target.value as typeof problem.status })
                  }
                >
                  <option value="ACTIVE">Ativo</option>
                  <option value="RESOLVED">Resolvido</option>
                  <option value="INACTIVE">Inativo/Histórico</option>
                </select>
              </label>
              <label className="space-y-1 text-sm font-medium">
                Início conhecido (opcional)
                <Input
                  type="date"
                  value={problem.onsetOn}
                  onChange={(event) => setProblem({ ...problem, onsetOn: event.target.value })}
                />
              </label>
              <label className="space-y-1 text-sm font-medium">
                Data de resolução {problem.status === "RESOLVED" ? "(obrigatória)" : "(opcional)"}
                <Input
                  type="date"
                  required={problem.status === "RESOLVED"}
                  value={problem.resolvedOn}
                  onChange={(event) => setProblem({ ...problem, resolvedOn: event.target.value })}
                />
              </label>
              <label className="space-y-1 text-sm font-medium md:col-span-2">
                Observações clínicas limitadas
                <Textarea
                  maxLength={2000}
                  rows={3}
                  value={problem.notes}
                  onChange={(event) => setProblem({ ...problem, notes: event.target.value })}
                />
              </label>
              <label className="space-y-1 text-sm font-medium md:col-span-2">
                Motivo da inclusão ou alteração
                <Input
                  required
                  minLength={10}
                  maxLength={500}
                  value={problem.reason}
                  onChange={(event) => setProblem({ ...problem, reason: event.target.value })}
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button disabled={pending}>{pending ? "Salvando…" : "Salvar registro"}</Button>
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => setProblemFormOpen(false)}
              >
                Cancelar
              </Button>
            </div>
          </form>
        ) : null}
        {clinicalProblems.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {clinicalProblems.map((item) => (
              <article key={item.id} className="rounded-lg border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{item.description}</p>
                      <Badge variant={item.status === "ACTIVE" ? "default" : "secondary"}>
                        {item.status === "ACTIVE"
                          ? "Ativo"
                          : item.status === "RESOLVED"
                            ? "Resolvido"
                            : "Histórico"}
                      </Badge>
                      {item.icd10Code ? (
                        <Badge variant="outline">CID-10 {item.icd10Code}</Badge>
                      ) : null}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {item.authorName} · {item.professionalCouncil} {item.councilNumber}/
                      {item.councilRegion}
                    </p>
                    {item.notes ? (
                      <p className="mt-3 whitespace-pre-wrap text-sm">{item.notes}</p>
                    ) : null}
                  </div>
                  {data.canManageClinicalProblems ? (
                    <Button variant="ghost" size="sm" onClick={() => editClinicalProblem(item)}>
                      Editar
                    </Button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">
            Nenhum problema ou antecedente clínico registrado.
          </p>
        )}
      </section>
      <section className="space-y-4 rounded-xl border bg-card p-5">
        <div>
          <h2 className="flex items-center gap-2 font-semibold">
            <Stethoscope className="size-4" /> Prontuário longitudinal
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Evoluções finalizadas, assinadas e ordenadas da mais recente para a mais antiga.
          </p>
        </div>
        {clinicalHistory.length ? (
          <div className="space-y-4">
            {clinicalHistory.map((note) => (
              <article key={note.id} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{note.careTypeName}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {new Intl.DateTimeFormat("pt-BR", {
                        dateStyle: "medium",
                        timeStyle: "short",
                        timeZone: "America/Fortaleza",
                      }).format(new Date(note.finalizedAt))}
                      {" · "}
                      {note.authorName} · {note.professionalCouncil} {note.councilNumber}/
                      {note.councilRegion}
                    </p>
                  </div>
                  <Button asChild variant="outline" size="sm">
                    <Link
                      to="/atendimentos/$appointmentId"
                      params={{ appointmentId: note.appointmentId }}
                    >
                      Abrir atendimento
                    </Link>
                  </Button>
                </div>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Evolução</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm">{note.evolution}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Conduta</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm">
                      {note.conduct || "Não informada."}
                    </p>
                  </div>
                </div>
                {(note.diagnosticHypotheses ||
                  note.clinicalPlan ||
                  note.returnRecommendation ||
                  note.returnOn) && (
                  <div className="mt-4 grid gap-4 rounded-lg bg-muted p-4 md:grid-cols-2">
                    <ClinicalText
                      label="Hipóteses ou diagnósticos"
                      value={note.diagnosticHypotheses}
                    />
                    <ClinicalText label="Plano clínico" value={note.clinicalPlan} />
                    <ClinicalText label="Retorno recomendado" value={note.returnRecommendation} />
                    <ClinicalText
                      label="Data sugerida para retorno"
                      value={note.returnOn ? note.returnOn.split("-").reverse().join("/") : ""}
                    />
                  </div>
                )}
                <ClinicalAnamnesis note={note} />
                <ClinicalPhysicalExam note={note} />
                <VitalsSummary note={note} />
              </article>
            ))}
          </div>
        ) : (
          <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">
            Ainda não há evoluções clínicas finalizadas para este paciente.
          </p>
        )}
      </section>
      {open && data.canManage && (
        <form onSubmit={save} className="space-y-4 rounded-xl border bg-card p-5">
          <h2 className="font-semibold">Tratamento prescrito</h2>
          <div className="grid gap-4 md:grid-cols-3">
            <label className="space-y-1 text-sm font-medium md:col-span-2">
              Produto
              <select
                required
                className="h-10 w-full rounded-md border bg-background px-3 font-normal"
                value={form.productId}
                onChange={(e) => setForm({ ...form, productId: e.target.value })}
              >
                <option value="">Selecione</option>
                {data.products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.sku}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm font-medium">
              Via
              <Input
                required
                value={form.route}
                onChange={(e) => setForm({ ...form, route: e.target.value })}
              />
            </label>
            <label className="space-y-1 text-sm font-medium">
              Dose
              <Input
                required
                type="number"
                min="0.000001"
                step="0.000001"
                value={form.doseQuantity}
                onChange={(e) => setForm({ ...form, doseQuantity: e.target.value })}
              />
            </label>
            <label className="space-y-1 text-sm font-medium">
              Unidade da dose
              <select
                className="h-10 w-full rounded-md border bg-background px-3"
                value={form.doseUnit}
                onChange={(e) => setForm({ ...form, doseUnit: e.target.value })}
              >
                <option>MG</option>
                <option>ML</option>
                <option>UI</option>
                <option>UNIT</option>
              </select>
            </label>
            <label className="space-y-1 text-sm font-medium">
              Aplicar a cada (dias)
              <Input
                required
                type="number"
                min="0.01"
                step="0.01"
                value={form.frequencyEveryDays}
                onChange={(e) => setForm({ ...form, frequencyEveryDays: e.target.value })}
              />
            </label>
            <label className="space-y-1 text-sm font-medium">
              Primeira aplicação
              <Input
                required
                type="date"
                value={form.firstScheduledOn}
                onChange={(e) => setForm({ ...form, firstScheduledOn: e.target.value })}
              />
            </label>
            <label className="space-y-1 text-sm font-medium">
              Aplicações previstas
              <Input
                type="number"
                min="1"
                value={form.plannedAdministrations}
                onChange={(e) => setForm({ ...form, plannedAdministrations: e.target.value })}
              />
            </label>
            <label className="space-y-1 text-sm font-medium">
              Situação
              <select
                className="h-10 w-full rounded-md border bg-background px-3"
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
              >
                {Object.entries(statusLabels).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm font-medium md:col-span-3">
              Motivo
              <Input
                required
                minLength={10}
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
              />
            </label>
          </div>
          <div className="flex gap-3">
            <Button disabled={pending}>{pending ? "Salvando…" : "Salvar tratamento"}</Button>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      )}
      <section className="rounded-xl border bg-card">
        <div className="border-b p-5">
          <h2 className="font-semibold">Tratamentos</h2>
        </div>
        {data.treatments.length ? (
          <div className="divide-y">
            {data.treatments.map((t) => (
              <div key={t.id} className="grid gap-3 p-5 md:grid-cols-[1fr_auto]">
                <div>
                  <p className="font-medium">{t.productName}</p>
                  <p className="text-sm text-muted-foreground">
                    {t.doseQuantity} {t.doseUnit} · {t.route} · a cada {t.frequencyEveryDays} dias ·
                    início {String(t.firstScheduledOn).slice(0, 10).split("-").reverse().join("/")}
                  </p>
                  {data.supplySummaries
                    .filter((s) => s.treatmentId === t.id)
                    .map((s) => (
                      <div
                        key={s.treatmentId}
                        className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-4"
                      >
                        <span>
                          Comprado:{" "}
                          <strong className="text-foreground">
                            {s.purchasedQuantity} {t.doseUnit}
                          </strong>
                        </span>
                        <span>
                          Reservado:{" "}
                          <strong className="text-foreground">
                            {s.reservedQuantity} {t.doseUnit}
                          </strong>
                        </span>
                        <span>
                          Consumido:{" "}
                          <strong className="text-foreground">
                            {s.consumedQuantity} {t.doseUnit}
                          </strong>
                        </span>
                        <span>
                          Saldo comprado total:{" "}
                          <strong className="text-foreground">
                            {s.purchasedRemaining} {t.doseUnit}
                          </strong>
                        </span>
                        <span>
                          Disponível para reservar:{" "}
                          <strong className="text-foreground">
                            {s.purchasedAvailableToReserve} {t.doseUnit}
                          </strong>
                        </span>
                        <span>
                          Estoque físico:{" "}
                          <strong className="text-foreground">{s.availableStockUnits} un.</strong>
                        </span>
                        <span>
                          Saldo aberto:{" "}
                          <strong className="text-foreground">
                            {s.openQuantity} {t.doseUnit}
                          </strong>
                        </span>
                        <span>
                          Livre após reservas:{" "}
                          <strong className="text-foreground">
                            {s.physicalUnreservedDose === null
                              ? "não calculado"
                              : `${s.physicalUnreservedDose} ${t.doseUnit}`}
                          </strong>
                        </span>
                        <span>
                          {s.unitShortageUnits === null ? (
                            "Apresentação/concentração ainda não vinculada"
                          ) : s.unitShortageUnits > 0 ? (
                            <strong className="text-destructive">
                              Faltam {s.unitShortageUnits} un. para a demanda da unidade
                            </strong>
                          ) : (
                            <strong className="text-success-foreground">
                              Cobertura física suficiente
                            </strong>
                          )}
                        </span>
                      </div>
                    ))}
                </div>
                <Badge>{statusLabels[t.status] ?? t.status}</Badge>
              </div>
            ))}
          </div>
        ) : (
          <p className="p-8 text-center text-sm text-muted-foreground">
            Nenhum tratamento cadastrado.
          </p>
        )}
      </section>
      {data.canManage && data.treatments.length > 0 && (
        <form onSubmit={savePurchase} className="space-y-4 rounded-xl border bg-card p-5">
          <div>
            <h2 className="font-semibold">Registrar compra do paciente</h2>
            <p className="text-sm text-muted-foreground">
              Registra o direito adquirido pelo paciente. Não altera o estoque físico.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <label className="space-y-1 text-sm font-medium">
              Tratamento
              <select
                required
                className="h-10 w-full rounded-md border bg-background px-3"
                value={purchase.treatmentId}
                onChange={(e) => setPurchase({ ...purchase, treatmentId: e.target.value })}
              >
                <option value="">Selecione</option>
                {data.treatments.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.productName} · {t.doseQuantity} {t.doseUnit}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm font-medium">
              Quantidade comprada
              <Input
                required
                type="number"
                min="0.000001"
                step="0.000001"
                value={purchase.purchasedQuantity}
                onChange={(e) => setPurchase({ ...purchase, purchasedQuantity: e.target.value })}
              />
            </label>
            <label className="space-y-1 text-sm font-medium">
              Valor total (opcional)
              <Input
                type="number"
                min="0"
                step="0.01"
                value={purchase.totalValue}
                onChange={(e) => setPurchase({ ...purchase, totalValue: e.target.value })}
              />
            </label>
            <label className="space-y-1 text-sm font-medium">
              Referência da venda
              <Input
                required
                minLength={3}
                value={purchase.reference}
                onChange={(e) => setPurchase({ ...purchase, reference: e.target.value })}
              />
            </label>
            <label className="space-y-1 text-sm font-medium">
              Data da compra
              <Input
                required
                type="date"
                value={purchase.purchasedOn}
                onChange={(e) => setPurchase({ ...purchase, purchasedOn: e.target.value })}
              />
            </label>
            <label className="space-y-1 text-sm font-medium">
              Motivo
              <Input
                required
                minLength={10}
                value={purchase.reason}
                onChange={(e) => setPurchase({ ...purchase, reason: e.target.value })}
              />
            </label>
          </div>
          <Button disabled={pending}>{pending ? "Salvando…" : "Registrar compra"}</Button>
        </form>
      )}
      <section className="rounded-xl border bg-card">
        <div className="border-b p-5">
          <h2 className="font-semibold">Agenda e reservas</h2>
          <p className="text-sm text-muted-foreground">
            Reservar sinaliza compromisso futuro; a baixa física acontecerá somente na aplicação.
          </p>
        </div>
        {data.schedule.length ? (
          <div className="divide-y">
            {data.schedule.map((item) => {
              const treatment = data.treatments.find((t) => t.id === item.treatmentId);
              return (
                <div
                  key={item.id}
                  className="flex flex-col justify-between gap-3 p-5 sm:flex-row sm:items-center"
                >
                  <div>
                    <p className="font-medium">
                      {String(item.scheduledOn).slice(0, 10).split("-").reverse().join("/")} ·{" "}
                      {treatment?.productName}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {item.doseQuantity} {item.doseUnit} ·{" "}
                      {scheduleLabels[item.status] ?? item.status}
                    </p>
                    {item.applicationId ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {item.applicationReference} · {item.applicationProfessional} · baixa de{" "}
                        {item.physicalQuantity} un. físicas · {item.applicationRoute}
                        {item.applicationDoseVolumeMl
                          ? ` · ${Number(item.applicationDoseVolumeMl).toLocaleString("pt-BR", { maximumFractionDigits: 3 })} mL`
                          : ""}
                      </p>
                    ) : null}
                    {!item.hasValidPrescription && item.status !== "CONSUMED" ? (
                      <p className="mt-1 text-xs text-destructive">
                        Sem prescrição válida para esta data
                      </p>
                    ) : null}
                  </div>
                  {(data.canManage || data.canConsume) && item.status !== "CONSUMED" && (
                    <div className="flex flex-wrap gap-2">
                      {data.canManage &&
                        item.status !== "RESERVED" &&
                        item.status !== "CANCELED" && (
                          <Button
                            type="button"
                            size="sm"
                            disabled={pending}
                            onClick={() => updateSchedule(item, "RESERVED")}
                          >
                            Reservar
                          </Button>
                        )}
                      {data.canManage && item.status === "RESERVED" && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={() => updateSchedule(item, "PLANNED")}
                        >
                          Liberar reserva
                        </Button>
                      )}
                      {data.canManage && item.status !== "CANCELED" && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={() => updateSchedule(item, "CANCELED")}
                        >
                          Cancelar
                        </Button>
                      )}
                      {data.canConsume && item.status !== "CANCELED" && (
                        <Button
                          type="button"
                          size="sm"
                          disabled={pending || !item.hasValidPrescription}
                          onClick={() => startApplication(item)}
                        >
                          Registrar aplicação
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="p-8 text-center text-sm text-muted-foreground">
            Informe a quantidade de aplicações ao criar o tratamento para gerar a agenda.
          </p>
        )}
      </section>
      {application.scheduleId && data.canConsume && (
        <form onSubmit={consumeSchedule} className="space-y-4 rounded-xl border bg-card p-5">
          <div>
            <h2 className="font-semibold">Confirmar aplicação e baixa física</h2>
            <p className="text-sm text-muted-foreground">
              O servidor escolherá os lotes disponíveis por FEFO. A confirmação cria uma saída
              imutável no ledger e não poderá ser simplesmente apagada.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1 text-sm font-medium">
              Dose efetivamente administrada
              <Input
                required
                type="number"
                min="0.000001"
                step="0.000001"
                value={application.administeredDoseQuantity}
                onChange={(event) =>
                  setApplication({
                    ...application,
                    administeredDoseQuantity: Number(event.target.value),
                    confirmed: false,
                  })
                }
              />
              <span className="block text-xs text-muted-foreground">
                {application.doseUnit}
                {application.doseVolumeMl !== null
                  ? ` · volume calculado: ${application.doseVolumeMl.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} mL`
                  : ""}
              </span>
            </label>
            <label className="space-y-1 text-sm font-medium">
              Via de administração
              <Input required readOnly value={application.route} />
            </label>
            <label className="space-y-1 text-sm font-medium">
              Local do consumo
              <select
                required
                className="h-10 w-full rounded-md border bg-background px-3"
                value={application.locationId}
                onChange={(event) =>
                  setApplication({ ...application, locationId: event.target.value })
                }
              >
                <option value="">Selecione</option>
                {data.locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm font-medium md:col-span-2">
              Intercorrência operacional (opcional)
              <Input
                maxLength={1000}
                placeholder="Sem intercorrências"
                value={application.occurrenceNotes}
                onChange={(event) =>
                  setApplication({ ...application, occurrenceNotes: event.target.value })
                }
              />
            </label>
            <label className="space-y-1 text-sm font-medium">
              Profissional executor
              <Input
                required
                minLength={3}
                maxLength={100}
                value={application.professional}
                onChange={(event) =>
                  setApplication({ ...application, professional: event.target.value })
                }
              />
            </label>
            <label className="space-y-1 text-sm font-medium">
              Referência
              <Input
                required
                minLength={3}
                maxLength={100}
                value={application.reference}
                onChange={(event) =>
                  setApplication({ ...application, reference: event.target.value })
                }
              />
            </label>
            <label className="space-y-1 text-sm font-medium">
              Justificativa operacional
              <Input
                required
                minLength={10}
                maxLength={500}
                value={application.reason}
                onChange={(event) => setApplication({ ...application, reason: event.target.value })}
              />
            </label>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={application.confirmed}
              onChange={(event) =>
                setApplication({ ...application, confirmed: event.target.checked })
              }
            />
            Conferi paciente, prescrição válida, dose, via, produto, profissional e local. Confirmo
            a aplicação e a baixa física.
          </label>
          <div className="flex flex-wrap gap-3">
            <Button disabled={pending || !application.confirmed}>
              {pending ? "Confirmando…" : "Confirmar aplicação"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() =>
                setApplication((current) => ({ ...current, operationId: "", scheduleId: "" }))
              }
            >
              Voltar sem registrar
            </Button>
          </div>
        </form>
      )}
      {data.canManage && data.treatments.length > 0 && (
        <form onSubmit={upload} className="space-y-4 rounded-xl border bg-card p-5">
          <div>
            <h2 className="font-semibold">Anexar prescrição</h2>
            <p className="text-sm text-muted-foreground">
              PDF ou foto, até 10 MB. O arquivo será privado e baixado somente após autorização.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1 text-sm font-medium">
              Tratamento
              <select
                name="treatmentId"
                required
                className="h-10 w-full rounded-md border bg-background px-3"
              >
                {data.treatments.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.productName}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm font-medium">
              Arquivo
              <Input
                name="file"
                required
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/heic,image/heif"
              />
            </label>
            <label className="space-y-1 text-sm font-medium">
              Nome do prescritor
              <Input name="prescriberName" required minLength={2} maxLength={150} />
            </label>
            <label className="space-y-1 text-sm font-medium">
              Conselho e número
              <Input
                name="councilNumber"
                required
                minLength={3}
                maxLength={30}
                placeholder="CRM 12345"
              />
            </label>
            <label className="space-y-1 text-sm font-medium">
              UF do conselho
              <Input name="councilRegion" required minLength={2} maxLength={10} placeholder="CE" />
            </label>
            <label className="space-y-1 text-sm font-medium">
              Data de emissão
              <Input name="issuedOn" required type="date" />
            </label>
            <label className="space-y-1 text-sm font-medium">
              Válida até
              <Input name="validUntil" required type="date" />
            </label>
            <label className="space-y-1 text-sm font-medium">
              Substitui uma prescrição? (opcional)
              <select
                name="supersedesId"
                className="h-10 w-full rounded-md border bg-background px-3"
              >
                <option value="">Não, novo documento</option>
                {data.prescriptions
                  .filter((prescription) => prescription.documentStatus === "ACTIVE")
                  .map((prescription) => (
                    <option key={prescription.id} value={prescription.id}>
                      {prescription.originalFilename} · versão {prescription.version}
                    </option>
                  ))}
              </select>
            </label>
            <label className="space-y-1 text-sm font-medium md:col-span-2">
              Motivo
              <Input
                name="reason"
                required
                minLength={10}
                defaultValue="Prescrição conferida e anexada ao tratamento."
              />
            </label>
          </div>
          <Button disabled={pending}>{pending ? "Enviando…" : "Guardar prescrição"}</Button>
        </form>
      )}
      <section className="rounded-xl border bg-card">
        <div className="border-b p-5">
          <h2 className="font-semibold">Prescrições protegidas</h2>
        </div>
        {data.prescriptions.length ? (
          <div className="divide-y">
            {data.prescriptions.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-4 p-5">
                <div className="flex items-center gap-3">
                  <FileText className="size-5 text-primary" />
                  <div>
                    <p className="font-medium">{p.originalFilename}</p>
                    <p className="text-xs text-muted-foreground">
                      Versão {p.version} · {Math.ceil(p.sizeBytes / 1024)} KB ·{" "}
                      {prescriptionLabels[p.effectiveStatus] ?? p.effectiveStatus}
                    </p>
                    {p.prescriberName ? (
                      <p className="text-xs text-muted-foreground">
                        {p.prescriberName} · {p.councilNumber}/{p.councilRegion} · emissão{" "}
                        {p.issuedOn?.split("-").reverse().join("/")} · validade{" "}
                        {p.validUntil?.split("-").reverse().join("/")}
                      </p>
                    ) : (
                      <p className="text-xs text-warning-foreground">
                        Documento legado: metadados clínicos pendentes
                      </p>
                    )}
                  </div>
                </div>
                <Button asChild variant="outline" size="sm">
                  <a
                    href={`/api/v1/inventory/prescriptions/${p.id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Abrir
                  </a>
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="p-8 text-center text-sm text-muted-foreground">
            Nenhuma prescrição anexada.
          </p>
        )}
      </section>
    </div>
  );
}

function ClinicalText({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 whitespace-pre-wrap text-sm">{value || "Não informado."}</p>
    </div>
  );
}

function VitalsSummary({ note }: { note: Payload["clinicalHistory"][number] }) {
  const weight = Number(note.weightKg);
  const heightMeters = Number(note.heightCm) / 100;
  const bmi = weight > 0 && heightMeters > 0 ? weight / heightMeters ** 2 : null;
  const values = [
    note.systolicPressure && note.diastolicPressure
      ? `PA ${note.systolicPressure}/${note.diastolicPressure} mmHg`
      : null,
    note.heartRate ? `FC ${note.heartRate} bpm` : null,
    note.oxygenSaturation ? `SpO₂ ${note.oxygenSaturation}%` : null,
    note.temperatureC ? `Temperatura ${note.temperatureC} °C` : null,
    note.weightKg ? `Peso ${note.weightKg} kg` : null,
    note.heightCm ? `Altura ${note.heightCm} cm` : null,
    bmi && Number.isFinite(bmi) ? `IMC ${bmi.toFixed(1)}` : null,
  ].filter(Boolean);
  return values.length ? (
    <div className="mt-4 flex flex-wrap gap-2">
      {values.map((value) => (
        <Badge key={value} variant="secondary">
          {value}
        </Badge>
      ))}
    </div>
  ) : null;
}

function ClinicalAnamnesis({ note }: { note: Payload["clinicalHistory"][number] }) {
  const fields = [
    ["Motivo da consulta", note.chiefComplaint],
    ["História atual", note.currentHistory],
    ["Antecedentes pessoais", note.personalHistory],
    ["Antecedentes familiares", note.familyHistory],
    ["Hábitos e contexto", note.habits],
    ["Revisão de sistemas", note.systemsReview],
  ].filter((field) => field[1]);
  return fields.length ? (
    <div className="mt-4 grid gap-3 rounded-lg bg-muted p-4 md:grid-cols-2">
      {fields.map(([label, value]) => (
        <div key={label}>
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="mt-1 whitespace-pre-wrap text-sm">{value}</p>
        </div>
      ))}
    </div>
  ) : null;
}

function ClinicalPhysicalExam({ note }: { note: Payload["clinicalHistory"][number] }) {
  const fields = [
    ["Estado geral", note.generalExam],
    ["Cardiovascular", note.cardiovascularExam],
    ["Respiratório", note.respiratoryExam],
    ["Abdominal", note.abdominalExam],
    ["Neurológico", note.neurologicalExam],
    ["Musculoesquelético", note.musculoskeletalExam],
    ["Pele e anexos", note.skinExam],
    ["Outros achados", note.otherExam],
  ].filter((field) => field[1]);
  return fields.length ? (
    <div className="mt-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Exame físico
      </p>
      <div className="grid gap-3 rounded-lg border p-4 md:grid-cols-2">
        {fields.map(([label, value]) => (
          <div key={label}>
            <p className="text-xs font-medium text-muted-foreground">{label}</p>
            <p className="mt-1 whitespace-pre-wrap text-sm">{value}</p>
          </div>
        ))}
      </div>
    </div>
  ) : null;
}
