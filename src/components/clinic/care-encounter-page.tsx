import { Link, useBlocker } from "@tanstack/react-router";
import "./clinical-workspace.css";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  ClipboardList,
  FileText,
  History,
  ListTree,
  Pill,
  ReceiptText,
  Stethoscope,
  UserRound,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { readInventoryResponse, useInventory } from "@/data/inventory-api";
import { InventoryState } from "./inventory-state";
import { EncounterPrescriptionCard } from "./encounter-prescription-card";
import { EncounterQuoteCard } from "./encounter-quote-card";
import { EncounterDocumentsCard } from "./encounter-documents-card";
import { treatmentCadenceLabel } from "@/data/treatment-cadence-label";

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
    frequencyEvery?: number | string | null;
    frequencyUnit?: string | null;
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
  canAuthorClinicalNote: boolean;
  canClaimClinicalNote: boolean;
  needsProfessionalRegistration: boolean;
  clinicalAuthorBlockReason: string | null;
  clinicalNote: null | {
    id: string;
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
    status: "DRAFT" | "FINAL";
    version: number;
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
    finalizedAt: string | null;
    updatedAt: string;
  };
  clinicalAlerts: Array<{
    id: string;
    type: "ALLERGY" | "WARNING" | "PRECAUTION";
    title: string;
    reaction: string | null;
    severity: "UNKNOWN" | "MILD" | "MODERATE" | "SEVERE";
    notes: string;
  }>;
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
  REASSIGN: "Profissional responsável alterado",
  STATUS: "Situação atualizada",
};
const scheduleLabels: Record<string, string> = {
  PLANNED: "Planejada",
  RESERVED: "Reservada",
  CONSUMED: "Consumida",
  CANCELED: "Cancelada",
};
const encounterSections = [
  { id: "resumo", label: "Resumo", icon: UserRound },
  { id: "evolucao", label: "Evolução", icon: FileText },
  { id: "anamnese", label: "Anamnese", icon: ListTree },
  { id: "exame-fisico", label: "Exame físico", icon: Stethoscope },
  { id: "avaliacao-plano", label: "Avaliação e plano", icon: ClipboardList },
  { id: "conduta", label: "Conduta", icon: FileText },
  { id: "prescricao", label: "Prescrição", icon: Pill },
  { id: "documentos", label: "Receitas e exames", icon: FileText },
  { id: "orcamento", label: "Orçamento", icon: ReceiptText },
  { id: "contexto", label: "Contexto e histórico", icon: History },
] as const;

function EncounterNavigation({ mobile = false }: { mobile?: boolean }) {
  return (
    <nav
      aria-label="Seções do atendimento"
      className={
        mobile
          ? "sticky top-16 z-10 mx-4 flex gap-1 overflow-x-auto rounded-2xl border bg-background/95 px-3 py-2 shadow-sm backdrop-blur lg:hidden"
          : "sticky top-40 hidden self-start rounded-2xl border bg-card p-3 lg:block"
      }
    >
      {!mobile ? (
        <p className="mb-3 px-3 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          Neste atendimento
        </p>
      ) : null}
      <div className={mobile ? "flex gap-1" : "space-y-1"}>
        {encounterSections.map((item) => (
          <a
            key={item.id}
            href={`#${item.id}`}
            className="flex h-9 shrink-0 items-center gap-2 rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <item.icon className="size-4" />
            {item.label}
          </a>
        ))}
      </div>
    </nav>
  );
}
const anamnesisTemplates = {
  sevenPillars: {
    label: "Anamnese 7 pilares (Tarso)",
    content: `ANAMNESE 7 PILARES (TARSO)

1. SONO
- Hora de início do sono:
- Quantidade de horas:
- Sono contínuo ou com interrupções:
- Nível de disposição ao acordar:

2. CONTROLE DO ESTRESSE / ANSIEDADE
- Nível de ansiedade:
- Insônia:
- Uso atual ou anterior de medicamentos alopáticos ou fitoterápicos para ansiedade:
- Psicoterapia atual ou anterior:
- Já recebeu de alguém a observação de que possui ansiedade:

3. ATIVIDADE FÍSICA
- Horário:
- Frequência:
- Intensidade e uso de frequencímetro/smartwatch:
- Objetivo:
- Nível de energia no treino:
- Nível de força:
- Nível de resistência:

4. ALIMENTAÇÃO
- Recordatório de 24 horas:
- Alimentos pró-inflamatórios:
- FODMAP:
- Intolerâncias e alergias:

5. INTESTINO
- Epigastralgia:
- Gases:
- Empachamento:
- Obstipação:
- Diarreia:
- Dor em cólica:
- Frequência de dejeções:
- Escala de Bristol:

6. MITOCÔNDRIA
- Fadiga:
- Intolerância ao exercício:
- Dores musculares difusas não relacionadas a trauma:
- Redução de performance física:
- Redução de performance cognitiva:

7. HOMEOSTASE HORMONAL
- Disposição ao acordar:
- Acorda cansado:
- Irritabilidade:
- Déficit de memória:
- Oscilação do humor:
- Intolerância a ruído:
- Tristeza sem causa aparente:
- Poder de tomada de decisão:`,
  },
  healthyLongevity: {
    label: "Anamnese Longevidade Saudável",
    content: `ANAMNESE LONGEVIDADE SAUDÁVEL

1. Queixa principal:
2. Sono/despertar — dificuldade para iniciar ou manter o sono, sonhos e como acorda:
3. Energia — fadiga ao acordar, horários de fadiga e picos de energia:
4. Intestino:
5. Memória:
6. Peso/composição corporal:
7. Desempenho sexual:
8. Atividade física:
9. Compulsão por doces:
10. Antecedentes pessoais:
11. Antecedentes familiares — IAM, AVC, câncer e Alzheimer:
12. Fármacos em uso:
13. Nota para a saúde atual, de 1 a 10:
14. Exames:
15. Programa proposto:`,
  },
  pedroNeuro: {
    label: "Anamnese Pedro Neuro",
    content: `ANAMNESE PEDRO NEURO

ATO 1 — PROBLEMAS: QUEIXA PRINCIPAL, EXPECTATIVA, QUESTIONÁRIOS E CONEXÃO
1. Identificar a queixa principal, as expectativas e o perfil do paciente:
2. História sucinta do paciente:

ATO 2 — MAP
3. Organização dos sintomas por mecanismos:
4. Registro das três fases da consulta — problemas, soluções e prática:

ATO 3 — ORIENTAÇÕES, RECEITAS E REQUISIÇÕES
5. Parceria terapêutica e orientações estabelecidas:`,
  },
} as const;
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
  const [evolution, setEvolution] = useState("");
  const [conduct, setConduct] = useState("");
  const [clinicalClosure, setClinicalClosure] = useState({
    diagnosticHypotheses: "",
    clinicalPlan: "",
    returnRecommendation: "",
    returnOn: "",
  });
  const [anamnesis, setAnamnesis] = useState({
    chiefComplaint: "",
    currentHistory: "",
    personalHistory: "",
    familyHistory: "",
    habits: "",
    systemsReview: "",
  });
  const [physicalExam, setPhysicalExam] = useState({
    generalExam: "",
    cardiovascularExam: "",
    respiratoryExam: "",
    abdominalExam: "",
    neurologicalExam: "",
    musculoskeletalExam: "",
    skinExam: "",
    otherExam: "",
  });
  const [vitals, setVitals] = useState({
    systolicPressure: "",
    diastolicPressure: "",
    heartRate: "",
    oxygenSaturation: "",
    temperatureC: "",
    weightKg: "",
    heightCm: "",
  });
  const [loadedNoteId, setLoadedNoteId] = useState<string | null | undefined>(undefined);
  const [loadedAppointmentId, setLoadedAppointmentId] = useState<string | null>(null);
  const [displayedVersion, setDisplayedVersion] = useState<number | null>(null);
  const [savedForm, setSavedForm] = useState<string | null>(null);
  const formSnapshot = JSON.stringify({
    evolution,
    conduct,
    clinicalClosure,
    anamnesis,
    physicalExam,
    vitals,
  });
  const dirty = savedForm !== null && savedForm !== formSnapshot;
  useBlocker({
    disabled: !dirty,
    enableBeforeUnload: dirty,
    shouldBlockFn: ({ current, next }) =>
      current.pathname !== next.pathname &&
      !window.confirm("Há alterações não salvas na evolução. Deseja sair e descartá-las?"),
  });
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const loadedNote = query.data?.clinicalNote;
  useEffect(() => {
    if (!query.data) return;
    if (
      loadedAppointmentId === query.data.appointment.id &&
      (loadedNoteId === (loadedNote?.id ?? null) || dirty)
    )
      return;
    setLoadedAppointmentId(query.data.appointment.id);
    setLoadedNoteId(loadedNote?.id ?? null);
    setDisplayedVersion(loadedNote?.version ?? null);
    const evolution = loadedNote?.evolution ?? "";
    setEvolution(evolution);
    const conduct = loadedNote?.conduct ?? "";
    setConduct(conduct);
    const clinicalClosure = {
      diagnosticHypotheses: loadedNote?.diagnosticHypotheses ?? "",
      clinicalPlan: loadedNote?.clinicalPlan ?? "",
      returnRecommendation: loadedNote?.returnRecommendation ?? "",
      returnOn: loadedNote?.returnOn ?? "",
    };
    setClinicalClosure(clinicalClosure);
    const anamnesis = {
      chiefComplaint: loadedNote?.chiefComplaint ?? "",
      currentHistory: loadedNote?.currentHistory ?? "",
      personalHistory: loadedNote?.personalHistory ?? "",
      familyHistory: loadedNote?.familyHistory ?? "",
      habits: loadedNote?.habits ?? "",
      systemsReview: loadedNote?.systemsReview ?? "",
    };
    setAnamnesis(anamnesis);
    const physicalExam = {
      generalExam: loadedNote?.generalExam ?? "",
      cardiovascularExam: loadedNote?.cardiovascularExam ?? "",
      respiratoryExam: loadedNote?.respiratoryExam ?? "",
      abdominalExam: loadedNote?.abdominalExam ?? "",
      neurologicalExam: loadedNote?.neurologicalExam ?? "",
      musculoskeletalExam: loadedNote?.musculoskeletalExam ?? "",
      skinExam: loadedNote?.skinExam ?? "",
      otherExam: loadedNote?.otherExam ?? "",
    };
    setPhysicalExam(physicalExam);
    const vitals = {
      systolicPressure: String(loadedNote?.systolicPressure ?? ""),
      diastolicPressure: String(loadedNote?.diastolicPressure ?? ""),
      heartRate: String(loadedNote?.heartRate ?? ""),
      oxygenSaturation: String(loadedNote?.oxygenSaturation ?? ""),
      temperatureC: String(loadedNote?.temperatureC ?? ""),
      weightKg: String(loadedNote?.weightKg ?? ""),
      heightCm: String(loadedNote?.heightCm ?? ""),
    };
    setVitals(vitals);
    setSavedForm(
      JSON.stringify({ evolution, conduct, clinicalClosure, anamnesis, physicalExam, vitals }),
    );
  }, [loadedNote, loadedNoteId, loadedAppointmentId, query.data, dirty]);
  if (query.isPending || query.error)
    return (
      <InventoryState pending={query.isPending} error={query.error} retry={() => query.refetch()} />
    );
  const data = query.data!;
  const appointment = data.appointment;

  async function saveClinicalNote(action: "SAVE_DRAFT" | "FINALIZE") {
    if (
      action === "FINALIZE" &&
      !window.confirm("Finalizar esta evolução? Depois disso, o conteúdo não poderá ser alterado.")
    )
      return;
    setPending(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/v1/inventory/care-encounter", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          appointmentId,
          evolution,
          conduct,
          ...clinicalClosure,
          returnOn: clinicalClosure.returnOn || null,
          ...anamnesis,
          ...physicalExam,
          ...Object.fromEntries(
            Object.entries(vitals).map(([key, value]) => [
              key,
              value === "" ? null : Number(value),
            ]),
          ),
          version: displayedVersion,
        }),
      });
      const saved = await readInventoryResponse<{ id: string; version: number }>(
        response,
        "Não foi possível salvar a evolução.",
      );
      if (!saved.data || !Number.isInteger(saved.data.version))
        throw new Error(
          "Resposta de salvamento inválida. Seu texto foi preservado; confira o rascunho antes de tentar novamente.",
        );
      setDisplayedVersion(saved.data.version);
      setLoadedNoteId(saved.data.id);
      setSavedForm(formSnapshot);
      await query.refetch();
      setMessage(action === "FINALIZE" ? "Evolução finalizada." : "Rascunho salvo.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha de conexão.");
    } finally {
      setPending(false);
    }
  }

  async function claimClinicalNote() {
    if (
      !window.confirm(
        `Assumir este atendimento no lugar de ${appointment.professionalName}? A alteração ficará registrada no histórico.`,
      )
    )
      return;
    setPending(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/v1/inventory/care-encounter", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "CLAIM", appointmentId, version: appointment.version }),
      });
      await readInventoryResponse(response, "Não foi possível assumir o atendimento.");
      await query.refetch();
      setMessage("Atendimento atribuído ao seu perfil. Você já pode registrar a evolução.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha de conexão.");
    } finally {
      setPending(false);
    }
  }

  function applyAnamnesisTemplate() {
    const template = anamnesisTemplates[selectedTemplate as keyof typeof anamnesisTemplates];
    if (!template) return;
    if (
      evolution.trim() &&
      !window.confirm("Substituir a evolução atual pelo modelo de anamnese selecionado?")
    )
      return;
    setEvolution(template.content);
  }

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
      await readInventoryResponse(response, "Não foi possível atualizar.");
      await query.refetch();
      setMessage(`Atendimento marcado como ${statusLabels[status]?.toLocaleLowerCase("pt-BR")}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha de conexão.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="clinical-workspace min-h-screen bg-background">
      <div className="border-b bg-background lg:sticky lg:top-16 lg:z-20">
        <div className="mx-auto flex max-w-[1320px] items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="shrink-0"
            aria-label="Voltar à agenda"
          >
            <Link to="/agenda">
              <ArrowLeft />
            </Link>
          </Button>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="truncate font-display text-lg font-semibold text-foreground sm:text-xl">
                {appointment.patientName}
              </h1>
              <Badge variant="outline" className="shrink-0">
                {statusLabels[appointment.status] ?? appointment.status}
              </Badge>
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground sm:text-sm">
              {appointment.patientCode} · {appointment.unitName} · {appointment.careTypeName} ·{" "}
              {dateTime(appointment.startsAt)} · {appointment.professionalName}
            </p>
          </div>
        </div>
      </div>
      <EncounterNavigation mobile />
      <div className="mx-auto grid max-w-[1320px] gap-6 px-4 py-5 sm:px-6 lg:grid-cols-[210px_minmax(0,960px)] lg:px-8 lg:py-7">
        <EncounterNavigation />
        <div className="min-w-0 space-y-5">
          <section id="resumo" className="scroll-mt-40 space-y-4">
            {(message || error) && (
              <div
                role={error ? "alert" : "status"}
                className="rounded-lg border px-4 py-3 text-sm"
              >
                {error || message}
              </div>
            )}
            {data.clinicalAlerts?.length ? (
              <section
                className="space-y-3 rounded-xl border border-warning bg-warning-soft p-5"
                role="alert"
              >
                <h2 className="flex items-center gap-2 font-semibold text-warning-foreground">
                  <AlertTriangle className="size-5" /> Alergias e alertas ativos
                </h2>
                <div className="grid gap-3 md:grid-cols-2">
                  {data.clinicalAlerts.map((item) => (
                    <article key={item.id} className="rounded-lg border bg-card p-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <strong>{item.title}</strong>
                        <Badge variant={item.severity === "SEVERE" ? "destructive" : "outline"}>
                          {item.severity === "SEVERE"
                            ? "Grave"
                            : item.severity === "MODERATE"
                              ? "Moderada"
                              : item.severity === "MILD"
                                ? "Leve"
                                : "Não informada"}
                        </Badge>
                      </div>
                      {item.reaction ? <p className="mt-2">Reação: {item.reaction}</p> : null}
                      {item.notes ? (
                        <p className="mt-1 text-xs text-muted-foreground">{item.notes}</p>
                      ) : null}
                    </article>
                  ))}
                </div>
              </section>
            ) : null}
            {data.canManage && ["SCHEDULED", "CONFIRMED"].includes(appointment.status) ? (
              <section className="flex flex-wrap gap-2 rounded-xl border bg-card p-4">
                {appointment.status === "SCHEDULED" ? (
                  <Button
                    variant="outline"
                    disabled={pending}
                    onClick={() => updateStatus("CONFIRMED")}
                  >
                    Confirmar presença
                  </Button>
                ) : null}
                {["SCHEDULED", "CONFIRMED"].includes(appointment.status) ? (
                  <Button disabled={pending} onClick={() => updateStatus("IN_PROGRESS")}>
                    Iniciar atendimento
                  </Button>
                ) : null}
              </section>
            ) : null}
          </section>
          <section id="evolucao" className="scroll-mt-40 space-y-4 rounded-xl border bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-semibold">Evolução clínica</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Rascunhos podem ser corrigidos. A finalização registra autoria e torna o conteúdo
                  imutável.
                </p>
              </div>
              <Badge variant="outline">
                {data.clinicalNote?.status === "FINAL"
                  ? "Finalizada"
                  : data.clinicalNote
                    ? "Rascunho"
                    : "Não iniciada"}
              </Badge>
            </div>
            <VitalsSection
              vitals={vitals}
              setVitals={setVitals}
              disabled={!data.canAuthorClinicalNote || data.clinicalNote?.status === "FINAL"}
            />
            <div className="space-y-2">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <label className="flex-1 space-y-1 text-sm font-medium">
                  Escolha um modelo de anamnese
                  <select
                    className="h-10 w-full rounded-md border bg-background px-3 font-normal"
                    value={selectedTemplate}
                    disabled={!data.canAuthorClinicalNote || data.clinicalNote?.status === "FINAL"}
                    onChange={(event) => setSelectedTemplate(event.target.value)}
                  >
                    <option value="">Selecione um modelo de anamnese (opcional)</option>
                    {Object.entries(anamnesisTemplates).map(([key, template]) => (
                      <option key={key} value={key}>
                        {template.label}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  type="button"
                  variant="outline"
                  disabled={
                    !selectedTemplate ||
                    !data.canAuthorClinicalNote ||
                    data.clinicalNote?.status === "FINAL"
                  }
                  onClick={applyAnamnesisTemplate}
                >
                  Inserir modelo
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                O modelo será inserido como texto editável na evolução e não substitui o julgamento
                clínico.
              </p>
            </div>
            <label className="block space-y-2 text-sm font-medium">
              Evolução
              <Textarea
                value={evolution}
                onChange={(event) => setEvolution(event.target.value)}
                disabled={!data.canAuthorClinicalNote || data.clinicalNote?.status === "FINAL"}
                rows={16}
                maxLength={20000}
                placeholder="Registre a evolução clínica."
                className="min-h-[420px] resize-y text-base leading-relaxed"
              />
            </label>
            <Accordion
              id="anamnese"
              type="multiple"
              className="scroll-mt-40 rounded-lg border px-4"
            >
              <AccordionItem value="structured-anamnesis" className="border-b-0">
                <AccordionTrigger className="text-base">Anamnese estruturada</AccordionTrigger>
                <AccordionContent>
                  <p className="mb-3 text-xs text-muted-foreground">
                    Preencha apenas os campos aplicáveis ao atendimento.
                  </p>
                  <fieldset
                    disabled={!data.canAuthorClinicalNote || data.clinicalNote?.status === "FINAL"}
                  >
                    <Accordion type="multiple" className="rounded-lg border px-4">
                      <AnamnesisField
                        label="Motivo da consulta"
                        field="chiefComplaint"
                        value={anamnesis.chiefComplaint}
                        maxLength={2000}
                        setAnamnesis={setAnamnesis}
                      />
                      <AnamnesisField
                        label="História da condição atual"
                        field="currentHistory"
                        value={anamnesis.currentHistory}
                        maxLength={10000}
                        setAnamnesis={setAnamnesis}
                      />
                      <AnamnesisField
                        label="Antecedentes pessoais"
                        field="personalHistory"
                        value={anamnesis.personalHistory}
                        maxLength={10000}
                        setAnamnesis={setAnamnesis}
                      />
                      <AnamnesisField
                        label="Antecedentes familiares"
                        field="familyHistory"
                        value={anamnesis.familyHistory}
                        maxLength={10000}
                        setAnamnesis={setAnamnesis}
                      />
                      <AnamnesisField
                        label="Hábitos e contexto"
                        field="habits"
                        value={anamnesis.habits}
                        maxLength={5000}
                        setAnamnesis={setAnamnesis}
                      />
                      <AnamnesisField
                        label="Revisão de sistemas"
                        field="systemsReview"
                        value={anamnesis.systemsReview}
                        maxLength={10000}
                        setAnamnesis={setAnamnesis}
                      />
                    </Accordion>
                  </fieldset>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
            <Accordion
              id="exame-fisico"
              type="multiple"
              className="scroll-mt-40 rounded-lg border px-4"
            >
              <AccordionItem value="structured-physical-exam" className="border-b-0">
                <AccordionTrigger className="text-base">Exame físico estruturado</AccordionTrigger>
                <AccordionContent>
                  <p className="mb-3 text-xs text-muted-foreground">
                    Registre somente os sistemas examinados neste atendimento.
                  </p>
                  <fieldset
                    disabled={!data.canAuthorClinicalNote || data.clinicalNote?.status === "FINAL"}
                  >
                    <Accordion type="multiple" className="rounded-lg border px-4">
                      <PhysicalExamField
                        label="Estado geral"
                        field="generalExam"
                        value={physicalExam.generalExam}
                        setPhysicalExam={setPhysicalExam}
                      />
                      <PhysicalExamField
                        label="Cardiovascular"
                        field="cardiovascularExam"
                        value={physicalExam.cardiovascularExam}
                        setPhysicalExam={setPhysicalExam}
                      />
                      <PhysicalExamField
                        label="Respiratório"
                        field="respiratoryExam"
                        value={physicalExam.respiratoryExam}
                        setPhysicalExam={setPhysicalExam}
                      />
                      <PhysicalExamField
                        label="Abdominal"
                        field="abdominalExam"
                        value={physicalExam.abdominalExam}
                        setPhysicalExam={setPhysicalExam}
                      />
                      <PhysicalExamField
                        label="Neurológico"
                        field="neurologicalExam"
                        value={physicalExam.neurologicalExam}
                        setPhysicalExam={setPhysicalExam}
                      />
                      <PhysicalExamField
                        label="Musculoesquelético"
                        field="musculoskeletalExam"
                        value={physicalExam.musculoskeletalExam}
                        setPhysicalExam={setPhysicalExam}
                      />
                      <PhysicalExamField
                        label="Pele e anexos"
                        field="skinExam"
                        value={physicalExam.skinExam}
                        setPhysicalExam={setPhysicalExam}
                      />
                      <PhysicalExamField
                        label="Outros achados"
                        field="otherExam"
                        value={physicalExam.otherExam}
                        setPhysicalExam={setPhysicalExam}
                      />
                    </Accordion>
                  </fieldset>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
            <section id="avaliacao-plano" className="scroll-mt-40 space-y-4 rounded-lg border p-4">
              <div>
                <h3 className="font-semibold">Avaliação e plano clínico</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Registre as hipóteses como avaliação do atendimento; elas não são convertidas
                  automaticamente em diagnóstico definitivo.
                </p>
              </div>
              <label className="block space-y-2 text-sm font-medium">
                Hipóteses diagnósticas e diagnósticos
                <Textarea
                  value={clinicalClosure.diagnosticHypotheses}
                  onChange={(event) =>
                    setClinicalClosure((current) => ({
                      ...current,
                      diagnosticHypotheses: event.target.value,
                    }))
                  }
                  disabled={!data.canAuthorClinicalNote || data.clinicalNote?.status === "FINAL"}
                  rows={4}
                  maxLength={10000}
                  placeholder="Descreva as hipóteses diagnósticas, os diagnósticos estabelecidos e os diagnósticos diferenciais relevantes."
                />
              </label>
              <label className="block space-y-2 text-sm font-medium">
                Plano clínico
                <Textarea
                  value={clinicalClosure.clinicalPlan}
                  onChange={(event) =>
                    setClinicalClosure((current) => ({
                      ...current,
                      clinicalPlan: event.target.value,
                    }))
                  }
                  disabled={!data.canAuthorClinicalNote || data.clinicalNote?.status === "FINAL"}
                  rows={4}
                  maxLength={10000}
                  placeholder="Registre o plano diagnóstico, terapêutico, de acompanhamento e as orientações."
                />
              </label>
              <div className="grid gap-4 md:grid-cols-[1fr_220px]">
                <label className="block space-y-2 text-sm font-medium">
                  Orientações para retorno
                  <Textarea
                    value={clinicalClosure.returnRecommendation}
                    onChange={(event) =>
                      setClinicalClosure((current) => ({
                        ...current,
                        returnRecommendation: event.target.value,
                      }))
                    }
                    disabled={!data.canAuthorClinicalNote || data.clinicalNote?.status === "FINAL"}
                    rows={3}
                    maxLength={2000}
                    placeholder="Ex.: retornar após os exames ou em quatro semanas."
                  />
                </label>
                <label className="block space-y-2 text-sm font-medium">
                  Data prevista para retorno
                  <Input
                    type="date"
                    value={clinicalClosure.returnOn}
                    onChange={(event) =>
                      setClinicalClosure((current) => ({
                        ...current,
                        returnOn: event.target.value,
                      }))
                    }
                    disabled={!data.canAuthorClinicalNote || data.clinicalNote?.status === "FINAL"}
                  />
                </label>
              </div>
            </section>
            <label id="conduta" className="block scroll-mt-40 space-y-2 text-sm font-medium">
              Conduta
              <Textarea
                value={conduct}
                onChange={(event) => setConduct(event.target.value)}
                disabled={!data.canAuthorClinicalNote || data.clinicalNote?.status === "FINAL"}
                rows={4}
                maxLength={10000}
                placeholder="Registre a conduta clínica adotada."
              />
            </label>
            {data.clinicalNote ? (
              <p className="text-xs text-muted-foreground">
                {data.clinicalNote.authorName} · {data.clinicalNote.professionalCouncil}{" "}
                {data.clinicalNote.councilNumber}/{data.clinicalNote.councilRegion}
                {data.clinicalNote.finalizedAt
                  ? ` · finalizada em ${dateTime(data.clinicalNote.finalizedAt)}`
                  : ` · salva em ${dateTime(data.clinicalNote.updatedAt)}`}
              </p>
            ) : null}
            {!data.canAuthorClinicalNote ? (
              <div className="space-y-3 rounded-lg bg-muted p-3 text-sm text-muted-foreground">
                <p>{data.clinicalAuthorBlockReason}</p>
                {data.canClaimClinicalNote ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={pending}
                    onClick={claimClinicalNote}
                  >
                    Assumir responsabilidade pelo atendimento
                  </Button>
                ) : null}
                {data.needsProfessionalRegistration ? (
                  <Button asChild type="button" variant="outline">
                    <Link to="/estoque/usuarios">Completar meu registro profissional</Link>
                  </Button>
                ) : null}
              </div>
            ) : null}
            {data.canAuthorClinicalNote && data.clinicalNote?.status !== "FINAL" ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() => saveClinicalNote("SAVE_DRAFT")}
                >
                  {pending ? "Salvando…" : "Salvar rascunho"}
                </Button>
                <Button
                  disabled={pending || evolution.trim().length < 10}
                  onClick={() => saveClinicalNote("FINALIZE")}
                >
                  {pending ? "Finalizando…" : "Finalizar evolução"}
                </Button>
              </div>
            ) : null}
          </section>
          <div id="prescricao" className="scroll-mt-40">
            <EncounterPrescriptionCard appointmentId={appointmentId} />
          </div>
          <div id="documentos" className="scroll-mt-40">
            <EncounterDocumentsCard appointmentId={appointmentId} />
          </div>
          <div id="orcamento" className="scroll-mt-40">
            <EncounterQuoteCard appointmentId={appointmentId} />
          </div>
          <div id="contexto" className="scroll-mt-40 grid gap-5 xl:grid-cols-[1fr_.9fr]">
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
                <Link
                  to="/pacientes/$patientId/prontuario"
                  params={{ patientId: appointment.patientId }}
                >
                  <UserRound /> Abrir prontuário do paciente
                </Link>
              </Button>
            </section>
            <section className="space-y-4 rounded-xl border bg-card p-5">
              <h2 className="flex items-center gap-2 font-semibold">
                <ClipboardList className="size-4" /> Planos terapêuticos ativos
              </h2>
              {data.treatments.length ? (
                <div className="space-y-3">
                  {data.treatments.map((item) => (
                    <article key={item.id} className="rounded-lg border p-3 text-sm">
                      <p className="font-medium">{item.productName}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {item.doseQuantity} {item.doseUnit} · {item.route} ·{" "}
                        {treatmentCadenceLabel(item)}
                      </p>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Nenhum plano terapêutico ativo.</p>
              )}
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
          {data.canManage && appointment.status === "IN_PROGRESS" && (
            <section
              aria-label="Conclusão do atendimento"
              className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border bg-card p-5"
            >
              <div>
                <h2 className="font-semibold">Conclusão do atendimento</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Confira a evolução, os documentos e a conduta antes de concluir.
                </p>
              </div>
              <Button disabled={pending} onClick={() => updateStatus("COMPLETED")}>
                Concluir atendimento
              </Button>
            </section>
          )}
        </div>
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

type Vitals = {
  systolicPressure: string;
  diastolicPressure: string;
  heartRate: string;
  oxygenSaturation: string;
  temperatureC: string;
  weightKg: string;
  heightCm: string;
};

type Anamnesis = {
  chiefComplaint: string;
  currentHistory: string;
  personalHistory: string;
  familyHistory: string;
  habits: string;
  systemsReview: string;
};

type PhysicalExam = {
  generalExam: string;
  cardiovascularExam: string;
  respiratoryExam: string;
  abdominalExam: string;
  neurologicalExam: string;
  musculoskeletalExam: string;
  skinExam: string;
  otherExam: string;
};

function PhysicalExamField({
  label,
  field,
  value,
  setPhysicalExam,
}: {
  label: string;
  field: keyof PhysicalExam;
  value: string;
  setPhysicalExam: React.Dispatch<React.SetStateAction<PhysicalExam>>;
}) {
  return (
    <AccordionItem value={`exam-${field}`}>
      <AccordionTrigger>
        <span className="flex items-center gap-2">
          {label}
          {value.trim() ? <Badge variant="secondary">Preenchido</Badge> : null}
        </span>
      </AccordionTrigger>
      <AccordionContent>
        <Textarea
          aria-label={label}
          rows={4}
          maxLength={5000}
          value={value}
          onChange={(event) =>
            setPhysicalExam((current) => ({ ...current, [field]: event.target.value }))
          }
          placeholder={`Registre os achados de ${label.toLocaleLowerCase("pt-BR")}.`}
        />
      </AccordionContent>
    </AccordionItem>
  );
}

function AnamnesisField({
  label,
  field,
  value,
  maxLength,
  setAnamnesis,
}: {
  label: string;
  field: keyof Anamnesis;
  value: string;
  maxLength: number;
  setAnamnesis: React.Dispatch<React.SetStateAction<Anamnesis>>;
}) {
  return (
    <AccordionItem value={`anamnesis-${field}`}>
      <AccordionTrigger>
        <span className="flex items-center gap-2">
          {label}
          {value.trim() ? <Badge variant="secondary">Preenchido</Badge> : null}
        </span>
      </AccordionTrigger>
      <AccordionContent>
        <Textarea
          aria-label={label}
          rows={4}
          maxLength={maxLength}
          value={value}
          onChange={(event) =>
            setAnamnesis((current) => ({ ...current, [field]: event.target.value }))
          }
          placeholder={`Registre ${label.toLocaleLowerCase("pt-BR")}.`}
        />
      </AccordionContent>
    </AccordionItem>
  );
}

function VitalsSection({
  vitals,
  setVitals,
  disabled,
}: {
  vitals: Vitals;
  setVitals: React.Dispatch<React.SetStateAction<Vitals>>;
  disabled: boolean;
}) {
  const weight = Number(vitals.weightKg);
  const heightMeters = Number(vitals.heightCm) / 100;
  const bmi = weight > 0 && heightMeters > 0 ? weight / heightMeters ** 2 : null;
  return (
    <div className="rounded-lg border p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">Sinais vitais</h3>
        <Badge variant="outline">
          IMC: {bmi && Number.isFinite(bmi) ? bmi.toFixed(1) : "aguardando peso e altura"}
        </Badge>
      </div>
      <fieldset disabled={disabled} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <VitalInput
          label="Pressão sistólica"
          suffix="mmHg"
          field="systolicPressure"
          value={vitals.systolicPressure}
          setVitals={setVitals}
          min={40}
          max={300}
        />
        <VitalInput
          label="Pressão diastólica"
          suffix="mmHg"
          field="diastolicPressure"
          value={vitals.diastolicPressure}
          setVitals={setVitals}
          min={20}
          max={200}
        />
        <VitalInput
          label="Frequência cardíaca"
          suffix="bpm"
          field="heartRate"
          value={vitals.heartRate}
          setVitals={setVitals}
          min={20}
          max={300}
        />
        <VitalInput
          label="Saturação"
          suffix="%"
          field="oxygenSaturation"
          value={vitals.oxygenSaturation}
          setVitals={setVitals}
          min={50}
          max={100}
          step="0.1"
        />
        <VitalInput
          label="Temperatura"
          suffix="°C"
          field="temperatureC"
          value={vitals.temperatureC}
          setVitals={setVitals}
          min={30}
          max={45}
          step="0.1"
        />
        <VitalInput
          label="Peso"
          suffix="kg"
          field="weightKg"
          value={vitals.weightKg}
          setVitals={setVitals}
          min={0.01}
          max={500}
          step="0.01"
        />
        <VitalInput
          label="Altura"
          suffix="cm"
          field="heightCm"
          value={vitals.heightCm}
          setVitals={setVitals}
          min={30}
          max={250}
          step="0.1"
        />
      </fieldset>
    </div>
  );
}

function VitalInput({
  label,
  suffix,
  field,
  value,
  setVitals,
  min,
  max,
  step = "1",
}: {
  label: string;
  suffix: string;
  field: keyof Vitals;
  value: string;
  setVitals: React.Dispatch<React.SetStateAction<Vitals>>;
  min: number;
  max: number;
  step?: string;
}) {
  return (
    <label className="space-y-1 text-xs text-muted-foreground">
      {label} ({suffix})
      <Input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => setVitals((current) => ({ ...current, [field]: event.target.value }))}
      />
    </label>
  );
}
