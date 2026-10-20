import { useQueryClient } from "@tanstack/react-query";
import { withSelectedUnit } from "@/data/unit-context";
import {
  encounterReviewLaboratoryResource,
  encounterReviewDocumentLimit,
} from "@/data/care-encounter-resources";
import type { ClinicalRequestsPayload } from "@/data/clinical-requests";
import { ClinicalRequestTracker } from "./clinical-request-tracker";
import { documentDraftHasContent, therapeuticDraftHasContent } from "@/lib/clinical-closure-policy";
import { PatientTimelinePage } from "./patient-timeline-page";
import { PreconsultationPanel } from "./preconsultation-panel";
import { CareTasksPanel } from "./care-tasks-panel";
import { PatientAllergySummary } from "./patient-allergy-summary";
import type { AllergySummary } from "@/lib/patient-allergies";
import { Link, useBlocker } from "@tanstack/react-router";
import "./clinical-workspace.css";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Menu,
  MoreHorizontal,
  List,
  Heading2,
  Plus,
  Save,
  CalendarClock,
  ClipboardList,
  FileText,
  History,
  UserRound,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ClinicalPatientHeader } from "./clinical-patient-header";
import {
  ClinicalLongitudinalNav,
  type ClinicalLongitudinalSection,
} from "./clinical-longitudinal-nav";
import {
  PatientDocumentCenter,
  type PatientDocumentCenterViewState,
} from "./patient-document-center";
import { PatientClinicalPlans } from "./patient-clinical-plans";
import { EncounterContextPanel } from "./encounter-context-panel";
import { EncounterExamsPanel } from "./encounter-exams-panel";
import { allergyLabel } from "@/lib/patient-allergies";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  allergySummary?: AllergySummary;
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
const encounterSteps = [
  { id: "anamnesis", label: "Anamnese" },
  { id: "exams", label: "Exames" },
  { id: "prescription", label: "Prescrição" },
  { id: "requests", label: "Solicitações" },
  { id: "review", label: "Revisão" },
] as const;
type EncounterStep = (typeof encounterSteps)[number]["id"];
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
  const queryClient = useQueryClient();
  const query = useInventory<Payload>(`care-encounter?appointmentId=${appointmentId}`);
  const [activeStep, setActiveStep] = useState<EncounterStep>("anamnesis");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [contextCollapsed, setContextCollapsed] = useState(false);
  const [documentDraftState, setDocumentDraftState] = useState({ dirty: false, pending: false });
  const onDocumentDraftStateChange = useCallback(
    (next: { dirty: boolean; pending: boolean }) =>
      setDocumentDraftState((current) =>
        current.dirty === next.dirty && current.pending === next.pending ? current : next,
      ),
    [],
  );
  const [prescriptionDraftState, setPrescriptionDraftState] = useState({
    dirty: false,
    pending: false,
  });
  const onPrescriptionDraftStateChange = useCallback(
    (next: { dirty: boolean; pending: boolean }) =>
      setPrescriptionDraftState((current) =>
        current.dirty === next.dirty && current.pending === next.pending ? current : next,
      ),
    [],
  );
  const [planDraftState, setPlanDraftState] = useState({ dirty: false, pending: false });
  const onPlanDraftStateChange = useCallback(
    (next: { dirty: boolean; pending: boolean }) =>
      setPlanDraftState((current) =>
        current.dirty === next.dirty && current.pending === next.pending ? current : next,
      ),
    [],
  );
  const [clinicalFileEditors, setClinicalFileEditors] = useState<
    Record<string, { dirty: boolean; pending: boolean }>
  >({});
  useEffect(() => {
    setClinicalFileEditors({});
    function receive(event: Event) {
      const state = (
        event as CustomEvent<{
          editorId: string;
          patientId: string;
          dirty: boolean;
          pending: boolean;
        }>
      ).detail;
      if (
        !state ||
        state.patientId !== query.data?.appointment.patientId ||
        typeof state.editorId !== "string" ||
        typeof state.dirty !== "boolean" ||
        typeof state.pending !== "boolean"
      )
        return;
      setClinicalFileEditors((current) => {
        if (!state.dirty && !state.pending) {
          const next = { ...current };
          delete next[state.editorId];
          return next;
        }
        if (
          current[state.editorId]?.dirty === state.dirty &&
          current[state.editorId]?.pending === state.pending
        )
          return current;
        return { ...current, [state.editorId]: { dirty: state.dirty, pending: state.pending } };
      });
    }
    window.addEventListener("allik:clinical-file-draft-state", receive);
    return () => window.removeEventListener("allik:clinical-file-draft-state", receive);
  }, [query.data?.appointment.patientId]);
  const clinicalFilesDirty = Object.values(clinicalFileEditors).some((state) => state.dirty);
  const clinicalFilesPending = Object.values(clinicalFileEditors).some((state) => state.pending);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [documentsOpen, setDocumentsOpen] = useState(false);
  const documentsViewState = useRef<PatientDocumentCenterViewState | null>(null);
  const documentsScroll = useRef(0);
  const [vitalsOpen, setVitalsOpen] = useState(false);
  const [allergiesOpen, setAllergiesOpen] = useState(false);
  const [questionnairesOpen, setQuestionnairesOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const documentsQuery = useInventory<{
    documents: Array<{
      id: string;
      type: string;
      title: string;
      status: string;
      content?: string;
      richContent?: unknown;
    }>;
    context?: { birthDate: string | null };
  }>(`encounter-documents?appointmentId=${encodeURIComponent(appointmentId)}`);
  const prescriptionQuery = useInventory<{
    prescription: null | { items: unknown[]; status: string; generalInstructions?: string };
  }>(`encounter-prescriptions?appointmentId=${appointmentId}`);
  const requestLifecycleQuery = useInventory<ClinicalRequestsPayload>(
    `clinical-requests?appointmentId=${appointmentId}`,
  );
  const quoteQuery = useInventory<{ quote: null | { status: string } }>(
    `encounter-quotes?appointmentId=${appointmentId}`,
  );
  const laboratoryFilesQuery = useInventory<{
    documents: Array<{ laboratoryStatus?: string | null }>;
    total: number;
  }>(
    encounterReviewLaboratoryResource(
      query.data?.appointment.patientId ?? "",
      query.data?.appointment.unitId ?? "",
    ),
    { enabled: Boolean(query.data?.appointment.patientId) && activeStep === "review" },
  );
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
  const navigationDirty =
    dirty ||
    documentDraftState.dirty ||
    prescriptionDraftState.dirty ||
    planDraftState.dirty ||
    clinicalFilesDirty ||
    pending ||
    documentDraftState.pending ||
    prescriptionDraftState.pending ||
    planDraftState.pending ||
    clinicalFilesPending;
  useBlocker({
    disabled: !navigationDirty,
    enableBeforeUnload: navigationDirty,
    shouldBlockFn: ({ current, next }) =>
      current.pathname !== next.pathname &&
      !window.confirm("Há alterações não salvas no atendimento. Deseja sair e descartá-las?"),
  });
  useEffect(() => {
    const blockUnitChange = (event: Event) => {
      if (
        navigationDirty ||
        pending ||
        documentDraftState.pending ||
        prescriptionDraftState.pending
      )
        event.preventDefault();
    };
    window.addEventListener("allik:before-unit-change", blockUnitChange);
    return () => window.removeEventListener("allik:before-unit-change", blockUnitChange);
  }, [navigationDirty, pending, documentDraftState.pending, prescriptionDraftState.pending]);
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
    const submitted = {
      action,
      appointmentId,
      evolution,
      conduct,
      ...clinicalClosure,
      returnOn: clinicalClosure.returnOn || null,
      ...anamnesis,
      ...physicalExam,
      ...Object.fromEntries(
        Object.entries(vitals).map(([key, value]) => [key, value === "" ? null : Number(value)]),
      ),
      version: displayedVersion,
    };
    const submittedSnapshot = formSnapshot;
    const reconciliationPath = withSelectedUnit(
      `/api/v1/inventory/care-encounter?appointmentId=${encodeURIComponent(appointmentId)}`,
    );
    setPending(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/v1/inventory/care-encounter", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(submitted),
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
      setSavedForm(submittedSnapshot);
      await query.refetch();
      setMessage(action === "FINALIZE" ? "Evolução finalizada." : "Rascunho salvo.");
    } catch (cause) {
      // A failed response does not prove rollback. Read once, never replay the write.
      // Only the exact next version, status and complete submitted content reconcile.
      let reconciled = false;
      try {
        const response = await fetch(reconciliationPath, { credentials: "same-origin" });
        const fresh = await readInventoryResponse<Payload>(
          response,
          "Não foi possível confirmar a evolução.",
        );
        const persisted = fresh.data?.clinicalNote;
        const expectedVersion = submitted.version === null ? 0 : submitted.version + 1;
        const expectedStatus = action === "FINALIZE" ? "FINAL" : "DRAFT";
        const contentMatches =
          persisted &&
          Object.entries(submitted).every(([key, wanted]) => {
            if (["action", "appointmentId", "version"].includes(key)) return true;
            const actual = (persisted as unknown as Record<string, unknown>)[key];
            if (wanted === null) return actual === null;
            if (typeof wanted === "number") return actual != null && Number(actual) === wanted;
            return (
              typeof wanted === "string" && typeof actual === "string" && actual === wanted.trim()
            );
          });
        if (
          fresh.data?.appointment.id === appointmentId &&
          persisted &&
          typeof persisted.id === "string" &&
          (!loadedNoteId || persisted.id === loadedNoteId) &&
          persisted.version === expectedVersion &&
          persisted.status === expectedStatus &&
          contentMatches
        ) {
          setDisplayedVersion(persisted.version);
          setLoadedNoteId(persisted.id);
          setSavedForm(submittedSnapshot);
          queryClient.setQueryData(["inventory", reconciliationPath], fresh.data);
          setMessage(
            action === "FINALIZE"
              ? "Finalização confirmada no servidor após falha de resposta."
              : "Rascunho confirmado no servidor após falha de resposta.",
          );
          reconciled = true;
        }
      } catch {
        /* Keep the local buffer and its original version when confirmation fails. */
      }
      if (!reconciled)
        setError(
          cause instanceof Error ? cause.message : "Falha de conexão. Seu texto foi preservado.",
        );
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
    if (status === "COMPLETED" && completionBlockReason) {
      setError(completionBlockReason);
      return;
    }
    if (
      status === "COMPLETED" &&
      !window.confirm(
        "Concluir este atendimento? A evolução deve estar finalizada e não pode haver conteúdo clínico em rascunho. Após a conclusão, os registros originais ficam somente leitura; adendos e retificações documentais seguem o fluxo explícito próprio.",
      )
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

  function insertClinicalText(text: string) {
    const input = editorRef.current;
    const start = input?.selectionStart ?? evolution.length;
    const end = input?.selectionEnd ?? start;
    setEvolution(evolution.slice(0, start) + text + evolution.slice(end));
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(start + text.length, start + text.length);
    });
  }
  function navigateStep(step: EncounterStep) {
    setActiveStep(step);
    requestAnimationFrame(() => document.getElementById(`encounter-tab-${step}`)?.focus());
  }
  function navigateContext(target: "exams" | "documents" | "questionnaires") {
    if (target === "questionnaires") setQuestionnairesOpen(true);
    else if (target === "documents") setDocumentsOpen(true);
    else navigateStep("exams");
  }
  function navigateLongitudinal(section: ClinicalLongitudinalSection) {
    if (section === "encounter") {
      navigateStep("anamnesis");
      return;
    }
    if (section === "history") {
      setHistoryOpen(true);
      return;
    }
    if (section === "documents") {
      setDocumentsOpen(true);
      return;
    }
    if (section === "treatments") {
      setDetailsOpen(true);
      return;
    }
    if (section === "questionnaires") {
      setQuestionnairesOpen(true);
      return;
    }
    navigateStep("review");
    requestAnimationFrame(() =>
      document.getElementById("orcamento")?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  }
  const canComplete = data.canManage && appointment.status === "IN_PROGRESS";
  const anyDirty =
    dirty ||
    documentDraftState.dirty ||
    prescriptionDraftState.dirty ||
    planDraftState.dirty ||
    clinicalFilesDirty;
  const anyPending =
    pending ||
    documentDraftState.pending ||
    prescriptionDraftState.pending ||
    planDraftState.pending ||
    clinicalFilesPending;
  const verificationPending =
    documentsQuery.isPending || prescriptionQuery.isPending || requestLifecycleQuery.isPending;
  const verificationError = Boolean(
    documentsQuery.error || prescriptionQuery.error || requestLifecycleQuery.error,
  );
  const persistedDrafts =
    documentsQuery.data?.documents.some(
      (item) => item.status === "DRAFT" && documentDraftHasContent(item.content, item.richContent),
    ) ||
    (prescriptionQuery.data?.prescription?.status === "DRAFT" &&
      therapeuticDraftHasContent(
        prescriptionQuery.data.prescription.items,
        prescriptionQuery.data.prescription.generalInstructions,
      ));
  const pendingPlans = requestLifecycleQuery.data?.requests?.some(
    (item) => item.sourceKind === "PLAN" && item.recordStatus === "DRAFT",
  );
  const completionBlockReason = anyDirty
    ? "Salve as alterações antes de concluir."
    : anyPending || verificationPending
      ? "Aguarde a verificação dos registros clínicos."
      : verificationError
        ? "Não foi possível verificar os registros. Tente novamente."
        : data.clinicalNote?.status !== "FINAL"
          ? "Finalize a evolução clínica antes de concluir."
          : persistedDrafts || pendingPlans
            ? "Resolva os rascunhos clínicos e planos vinculados antes de concluir."
            : null;
  const completeDisabled = Boolean(completionBlockReason);
  const completedDocuments =
    documentsQuery.data?.documents.filter((item) => item.status === "FINAL") ?? [];
  const instructionsCount =
    documentsQuery.data?.documents.filter((item) => item.type === "INSTRUCTIONS").length ?? 0;
  const hasReturnGuidance = Boolean(
    clinicalClosure.returnRecommendation.trim() || clinicalClosure.returnOn,
  );

  return (
    <div className="clinical-workspace encounter-workspace min-h-screen bg-background">
      <h1 className="sr-only">Atendimento de {appointment.patientName}</h1>
      <p aria-live="polite" className="sr-only">
        Etapa atual: {encounterSteps.find((step) => step.id === activeStep)?.label}
      </p>
      <div className="encounter-toolbar flex min-h-[54px] flex-wrap items-center justify-between gap-2 px-4 py-2 lg:px-5">
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <Button
            variant="ghost"
            size="icon"
            className="size-7 lg:hidden"
            aria-label={sidebarOpen ? "Recolher navegação clínica" : "Abrir navegação clínica"}
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            <Menu className="size-4" />
          </Button>
          <Link to="/pacientes">Pacientes</Link>
          <ChevronRight className="size-3" />
          <Link
            to="/pacientes/$patientId"
            params={{ patientId: appointment.patientId }}
            className="max-w-44 truncate"
          >
            {appointment.patientName}
          </Link>
          <ChevronRight className="size-3" />
          <span className="font-semibold text-foreground">Atendimento</span>
        </div>
        <div className="flex items-center gap-3">
          <span
            role="status"
            aria-live="polite"
            className="hidden items-center gap-1 text-[11px] text-muted-foreground sm:flex"
          >
            <CheckCircle2
              className={anyDirty ? "size-3.5 text-amber-600" : "size-3.5 text-emerald-600"}
            />
            {anyPending
              ? "Processando…"
              : anyDirty
                ? "Alterações não salvas"
                : data.clinicalNote
                  ? `Último salvamento: ${dateTime(data.clinicalNote.updatedAt)}`
                  : "Evolução ainda não salva"}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                Mais ações <ChevronDown className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setDetailsOpen(true)}>
                Contexto e histórico do atendimento
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setVitalsOpen(true)}>
                Editar sinais vitais
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setAllergiesOpen(true)}>
                Conferir alergias e alertas
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setQuestionnairesOpen(true)}>
                Questionários e tarefas
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigateStep("review")}>
                Revisar atendimento e orçamento
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {canComplete ? (
            <Button
              size="sm"
              disabled={completeDisabled}
              title={completionBlockReason ?? undefined}
              onClick={() => updateStatus("COMPLETED")}
            >
              Concluir atendimento
            </Button>
          ) : (
            <Badge variant="outline">
              {statusLabels[appointment.status] ?? appointment.status}
            </Badge>
          )}
        </div>
      </div>
      <div className="px-4 lg:px-5">
        <ClinicalPatientHeader
          name={appointment.patientName}
          birthDate={documentsQuery.data?.context?.birthDate ?? null}
          code={appointment.patientCode}
          unitName={appointment.unitName}
          secondaryInfo={
            <span>
              {appointment.professionalName} · {appointment.careTypeName}
            </span>
          }
          vitals={
            <button
              type="button"
              onClick={() => setVitalsOpen(true)}
              className="w-full text-left text-xs leading-5 text-muted-foreground"
              aria-label="Ver ou editar sinais vitais"
            >
              <div className="grid grid-cols-2 gap-x-3">
                <span>
                  PA{" "}
                  {vitals.systolicPressure && vitals.diastolicPressure
                    ? `${vitals.systolicPressure}/${vitals.diastolicPressure} mmHg`
                    : "—"}
                </span>
                <span>FC {vitals.heartRate ? `${vitals.heartRate} bpm` : "—"}</span>
                <span>SpO₂ {vitals.oxygenSaturation ? `${vitals.oxygenSaturation}%` : "—"}</span>
                <span>T {vitals.temperatureC ? `${vitals.temperatureC} °C` : "—"}</span>
              </div>
              <span className="mt-1 block text-[10px]">
                {dirty
                  ? "Alterações não salvas"
                  : data.clinicalNote?.updatedAt
                    ? `Nota atualizada em ${dateTime(data.clinicalNote.updatedAt)} · horário de medição não registrado`
                    : "Registrar sinais vitais"}
              </span>
            </button>
          }
          allergies={
            <button
              type="button"
              className="w-full text-left text-xs"
              onClick={() => setAllergiesOpen(true)}
              aria-label="Ver alergias e alertas"
            >
              <div className="flex flex-wrap gap-1">
                {data.allergySummary?.allergies.length ? (
                  data.allergySummary.allergies.map((item) => (
                    <span key={item} className="rounded-lg bg-rose-100 px-2 py-1 text-rose-800">
                      {item}
                    </span>
                  ))
                ) : (
                  <span className="text-muted-foreground">
                    {data.allergySummary
                      ? allergyLabel(data.allergySummary)
                      : "Alergias não informadas"}
                  </span>
                )}
              </div>
              {data.allergySummary?.status === "REPORTED" && (
                <span className="mt-1 block text-amber-800">
                  Relatadas · não verificadas
                  {data.allergySummary.reviewedAt
                    ? ` · revisão ${dateTime(data.allergySummary.reviewedAt)}`
                    : ""}
                </span>
              )}
              {data.clinicalAlerts.some((item) => item.type !== "ALLERGY") && (
                <span className="mt-1 block text-amber-700">
                  Há outros alertas ativos · ver detalhes
                </span>
              )}
            </button>
          }
          diagnoses={
            <button
              type="button"
              className="w-full text-left text-xs"
              onClick={() => {
                navigateStep("anamnesis");
                requestAnimationFrame(() => {
                  const element = document.getElementById(
                    "avaliacao-plano",
                  ) as HTMLDetailsElement | null;
                  if (element) {
                    element.open = true;
                    element.scrollIntoView({ behavior: "smooth", block: "center" });
                    element
                      .querySelector<HTMLElement>(
                        "textarea:not(:disabled), input:not(:disabled), summary",
                      )
                      ?.focus();
                  }
                });
              }}
            >
              <span
                className={
                  clinicalClosure.diagnosticHypotheses.trim()
                    ? "line-clamp-2 rounded-lg bg-amber-50 px-2 py-1 text-amber-900"
                    : "text-muted-foreground"
                }
              >
                {clinicalClosure.diagnosticHypotheses ||
                  "Nenhuma hipótese registrada neste atendimento"}
              </span>
            </button>
          }
        />
      </div>
      {(message || error) && (
        <div
          role={error ? "alert" : "status"}
          className={
            error
              ? "mx-4 mt-3 rounded-lg border bg-card px-4 py-2 text-sm text-destructive lg:mx-5"
              : "pointer-events-none fixed bottom-4 right-4 z-50 max-w-sm rounded-lg border bg-card px-4 py-3 text-sm text-foreground shadow-sm"
          }
        >
          {error || message}
        </div>
      )}
      <div className="encounter-content-grid grid min-w-0 gap-3 px-4 py-3 lg:grid-cols-[205px_minmax(0,1fr)] lg:px-5">
        <ClinicalLongitudinalNav
          patientId={appointment.patientId}
          open={sidebarOpen}
          onCloseMobile={() => setSidebarOpen(false)}
          onSelect={navigateLongitudinal}
        />
        <div className="min-w-0">
          <nav
            aria-label="Etapas do atendimento"
            className="encounter-step-nav mb-3 flex min-h-10 max-w-full overflow-x-auto border-b"
            role="tablist"
          >
            {encounterSteps.map((step, index) => (
              <button
                key={step.id}
                type="button"
                role="tab"
                id={`encounter-tab-${step.id}`}
                aria-selected={activeStep === step.id}
                aria-controls={`encounter-panel-${step.id === "requests" || step.id === "prescription" ? "documents" : step.id}`}
                tabIndex={activeStep === step.id ? 0 : -1}
                onKeyDown={(event) => {
                  if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                    event.preventDefault();
                    const next =
                      encounterSteps[
                        (index + (event.key === "ArrowRight" ? 1 : -1) + encounterSteps.length) %
                          encounterSteps.length
                      ]!;
                    setActiveStep(next.id);
                    document.getElementById(`encounter-tab-${next.id}`)?.focus();
                  }
                }}
                onClick={() => setActiveStep(step.id)}
                className={`encounter-step-tab flex min-w-28 flex-1 items-center justify-center gap-2 border-b-2 px-3 pb-2 text-xs transition-colors ${activeStep === step.id ? "border-primary font-semibold text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
              >
                <span
                  aria-hidden="true"
                  className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs ${activeStep === step.id ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}
                >
                  {index + 1}
                </span>
                {step.label}
              </button>
            ))}
          </nav>
          <div
            className={`encounter-panels grid min-w-0 items-start gap-3 ${activeStep === "anamnesis" ? (contextCollapsed ? "xl:grid-cols-[minmax(0,1fr)_48px]" : "xl:grid-cols-[minmax(0,1fr)_minmax(260px,328px)]") : ""}`}
          >
            <main className="encounter-main-card min-w-0 rounded-xl border bg-card p-2">
              <div
                role="tabpanel"
                id="encounter-panel-anamnesis"
                aria-labelledby="encounter-tab-anamnesis"
                hidden={activeStep !== "anamnesis"}
              >
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
                <section
                  id="evolucao"
                  className="encounter-editor-surface space-y-3 rounded-xl border bg-card p-3 sm:p-4"
                >
                  <div className="flex items-center justify-between gap-3 pb-1">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-primary">
                        <FileText className="size-5" />
                      </span>
                      <div>
                        <h2 className="text-lg font-semibold">Anamnese e evolução</h2>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          História clínica, exame físico, avaliação e plano
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setTemplatesOpen(!templatesOpen)}
                        aria-expanded={templatesOpen}
                      >
                        <FileText className="size-4" /> Modelos
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        aria-label="Informações do atendimento"
                        onClick={() => setDetailsOpen(true)}
                      >
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </div>
                  </div>
                  <div
                    hidden={!templatesOpen}
                    className="space-y-2 rounded-lg border bg-muted/30 p-3"
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                      <label className="flex-1 space-y-1 text-sm font-medium">
                        Escolha um modelo de anamnese
                        <select
                          className="h-10 w-full rounded-md border bg-background px-3 font-normal"
                          value={selectedTemplate}
                          disabled={
                            !data.canAuthorClinicalNote || data.clinicalNote?.status === "FINAL"
                          }
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
                      O modelo será inserido como texto editável na evolução e não substitui o
                      julgamento clínico.
                    </p>
                  </div>
                  <div className="overflow-hidden rounded-lg border">
                    <div
                      className="flex h-9 items-center gap-1 border-b bg-muted/30 px-2"
                      role="toolbar"
                      aria-label="Ferramentas do texto clínico"
                    >
                      <span className="mr-2 border-r pr-3 text-xs text-muted-foreground">
                        Texto clínico
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        disabled={
                          !data.canAuthorClinicalNote || data.clinicalNote?.status === "FINAL"
                        }
                        onClick={() => insertClinicalText("\n\nHistória clínica / Anamnese\n")}
                      >
                        <Heading2 className="size-3.5" /> Seção
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        disabled={
                          !data.canAuthorClinicalNote || data.clinicalNote?.status === "FINAL"
                        }
                        onClick={() => insertClinicalText("\n• ")}
                      >
                        <List className="size-3.5" /> Lista
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        disabled={
                          !data.canAuthorClinicalNote || data.clinicalNote?.status === "FINAL"
                        }
                        onClick={() =>
                          insertClinicalText(
                            "\n\nExame físico\n\nAvaliação clínica\n\nPlano e conduta\n\nOrientações e retorno\n",
                          )
                        }
                      >
                        <Plus className="size-3.5" /> Estrutura
                      </Button>
                    </div>
                    <label className="block text-sm font-medium">
                      <span className="sr-only">Evolução</span>
                      <Textarea
                        ref={editorRef}
                        value={evolution}
                        onChange={(event) => setEvolution(event.target.value)}
                        disabled={
                          !data.canAuthorClinicalNote || data.clinicalNote?.status === "FINAL"
                        }
                        rows={12}
                        maxLength={20000}
                        placeholder={
                          "1. História clínica / Anamnese\nRegistre a história clínica deste atendimento.\n\n2. Exame físico\n\n3. Avaliação clínica\n\n4. Plano e conduta\n\n5. Orientações e retorno"
                        }
                        className="min-h-[360px] resize-y rounded-none border-0 px-5 py-4 text-[13px] leading-7 shadow-none focus-visible:ring-inset"
                      />
                    </label>
                  </div>
                  <details
                    id="avaliacao-plano"
                    className="encounter-closure-accordion scroll-mt-40 rounded-lg border px-3 sm:px-4"
                  >
                    <summary className="cursor-pointer py-3 text-sm font-semibold">
                      Hipóteses diagnósticas, plano clínico e retorno{" "}
                      <span className="ml-2 font-normal text-muted-foreground">
                        {clinicalClosure.diagnosticHypotheses.trim()
                          ? "Preenchido"
                          : "Não registrado"}
                      </span>
                    </summary>
                    <div className="space-y-4 pb-4">
                      <div>
                        <h3 className="font-semibold">Avaliação e plano clínico</h3>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Registre as hipóteses como avaliação do atendimento; elas não são
                          convertidas automaticamente em diagnóstico definitivo.
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
                          disabled={
                            !data.canAuthorClinicalNote || data.clinicalNote?.status === "FINAL"
                          }
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
                          disabled={
                            !data.canAuthorClinicalNote || data.clinicalNote?.status === "FINAL"
                          }
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
                            disabled={
                              !data.canAuthorClinicalNote || data.clinicalNote?.status === "FINAL"
                            }
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
                            disabled={
                              !data.canAuthorClinicalNote || data.clinicalNote?.status === "FINAL"
                            }
                          />
                        </label>
                      </div>
                    </div>
                  </details>
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
              </div>
              <div
                role="tabpanel"
                id="encounter-panel-exams"
                aria-labelledby="encounter-tab-exams"
                hidden={activeStep !== "exams"}
              >
                <EncounterExamsPanel
                  patientId={appointment.patientId}
                  unitId={appointment.unitId}
                  onNavigate={navigateContext}
                  active={activeStep === "exams"}
                />
              </div>
              <div
                role="tabpanel"
                id="encounter-panel-documents"
                aria-labelledby={`encounter-tab-${activeStep === "requests" ? "requests" : "prescription"}`}
                hidden={activeStep !== "prescription" && activeStep !== "requests"}
              >
                <div id="documentos">
                  <EncounterDocumentsCard
                    appointmentId={appointmentId}
                    mode={activeStep === "requests" ? "requests" : "prescription"}
                    onDraftStateChange={onDocumentDraftStateChange}
                    procedures={
                      <PatientClinicalPlans
                        patientId={appointment.patientId}
                        appointmentId={appointmentId}
                        onDraftStateChange={onPlanDraftStateChange}
                      />
                    }
                    medications={({ onInsert, canInsert, search }) => (
                      <EncounterPrescriptionCard
                        appointmentId={appointmentId}
                        onDraftStateChange={onPrescriptionDraftStateChange}
                        onInsertIntoDocument={onInsert}
                        canInsertIntoDocument={canInsert}
                        searchQuery={search}
                      />
                    )}
                  />
                  <div hidden={activeStep !== "requests"} className="p-3">
                    <ClinicalRequestTracker appointmentId={appointmentId} />
                  </div>
                </div>
              </div>
              <div
                role="tabpanel"
                id="encounter-panel-review"
                aria-labelledby="encounter-tab-review"
                hidden={activeStep !== "review"}
                className="encounter-review-panel space-y-3 p-3 sm:p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold">Resumo do atendimento</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Revise as informações antes de concluir.
                    </p>
                  </div>
                  {data.canAuthorClinicalNote && data.clinicalNote?.status !== "FINAL" ? (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={pending}
                        onClick={() => saveClinicalNote("SAVE_DRAFT")}
                      >
                        <Save className="size-3.5" />
                        Salvar rascunho
                      </Button>
                      <Button
                        size="sm"
                        disabled={pending || evolution.trim().length < 10}
                        onClick={() => saveClinicalNote("FINALIZE")}
                      >
                        {pending ? "Finalizando…" : "Finalizar evolução"}
                      </Button>
                    </div>
                  ) : null}
                </div>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
                  {[
                    {
                      label: "Evolução clínica",
                      value:
                        data.clinicalNote?.status === "FINAL"
                          ? "Finalizada"
                          : evolution.trim()
                            ? dirty
                              ? "Alterações não salvas"
                              : "Rascunho salvo"
                            : "Não registrada",
                      target: "anamnesis",
                    },
                    {
                      label: "Diagnósticos e hipóteses",
                      value: clinicalClosure.diagnosticHypotheses.trim()
                        ? "Registrados na avaliação"
                        : "Não registrados",
                      target: "anamnesis",
                    },
                    {
                      label: "Prescrição",
                      value:
                        prescriptionQuery.error || documentsQuery.error
                          ? "Não foi possível verificar"
                          : documentsQuery.isPending || prescriptionQuery.isPending
                            ? "Consultando…"
                            : `${documentsQuery.data?.documents.filter((item) => item.type === "PRESCRIPTION" && item.status === "FINAL").length ?? 0} receita(s) finalizada(s) · ${documentsQuery.data?.documents.filter((item) => item.type === "PRESCRIPTION" && item.status === "DRAFT").length ?? 0} rascunho(s) · Registro terapêutico: ${prescriptionQuery.data?.prescription ? (prescriptionQuery.data.prescription.status === "FINAL" ? "finalizado" : therapeuticDraftHasContent(prescriptionQuery.data.prescription.items, prescriptionQuery.data.prescription.generalInstructions) ? "rascunho persistido" : "vazio · nenhum conteúdo pendente") : "não iniciado (opcional)"} · ${prescriptionQuery.data?.prescription?.items.length ?? 0} item(ns)`,
                      target: "prescription",
                    },
                    {
                      label: "Solicitações e documentos",
                      value: documentsQuery.error
                        ? "Não foi possível verificar"
                        : documentsQuery.isPending
                          ? "Consultando…"
                          : `${documentsQuery.data?.documents.filter((item) => item.type !== "PRESCRIPTION" && item.status === "FINAL").length ?? 0} finalizado(s) · ${documentsQuery.data?.documents.filter((item) => item.type !== "PRESCRIPTION" && item.status === "DRAFT").length ?? 0} rascunho(s) · ${requestLifecycleQuery.data?.requests?.filter((item) => item.sourceKind === "PLAN").length ?? 0} plano(s) vinculado(s)`,
                      target: "requests",
                    },
                    {
                      label: "Orientações e retorno",
                      value: documentsQuery.error
                        ? "Não foi possível verificar orientações"
                        : documentsQuery.isPending
                          ? "Consultando…"
                          : instructionsCount
                            ? `${hasReturnGuidance ? "Retorno · " : ""}${instructionsCount} documento(s) de orientações`
                            : hasReturnGuidance
                              ? "Retorno registrado"
                              : "Não registrados",
                      target:
                        instructionsCount > 0 && !hasReturnGuidance ? "prescription" : "anamnesis",
                    },
                    {
                      label: "Orçamento",
                      value: quoteQuery.error
                        ? "Não foi possível verificar"
                        : quoteQuery.isPending
                          ? "Consultando…"
                          : quoteQuery.data?.quote
                            ? ((
                                {
                                  DRAFT: "Rascunho",
                                  ISSUED: "Emitido",
                                  APPROVED: "Aprovado",
                                  DECLINED: "Recusado",
                                  PAID: "Pago",
                                } as Record<string, string>
                              )[quoteQuery.data.quote.status] ?? "Disponível")
                            : "Não iniciado · opcional",
                      target: "review",
                    },
                  ].map((item) => (
                    <article key={item.label} className="rounded-lg border p-3">
                      <h3 className="text-xs font-semibold">{item.label}</h3>
                      <p className="my-2 text-xs text-muted-foreground">{item.value}</p>
                      <button
                        type="button"
                        className="rounded bg-accent px-2 py-1 text-xs font-medium text-primary"
                        onClick={() => {
                          navigateStep(item.target as EncounterStep);
                          if (item.target === "review")
                            requestAnimationFrame(() =>
                              document
                                .getElementById("orcamento")
                                ?.scrollIntoView?.({ behavior: "smooth", block: "start" }),
                            );
                        }}
                      >
                        Revisar
                      </button>
                    </article>
                  ))}
                </div>
                <section className="rounded-lg border bg-amber-50/40 p-3">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <AlertTriangle className="size-4 text-amber-600" />
                    Pendências e conferência
                  </h3>
                  <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                    {anyDirty && (
                      <li>
                        Há alterações não salvas nos editores. Salve os rascunhos antes de concluir.
                      </li>
                    )}
                    {data.clinicalNote?.status !== "FINAL" && (
                      <li>
                        A evolução ainda não foi finalizada. Finalize-a antes de concluir o
                        atendimento.
                      </li>
                    )}
                    {documentsQuery.data?.documents.some(
                      (item) =>
                        item.status === "DRAFT" &&
                        documentDraftHasContent(item.content, item.richContent),
                    ) && (
                      <li>
                        Há documentos com conteúdo em rascunho. Finalize ou limpe o conteúdo antes
                        de concluir.
                      </li>
                    )}
                    {prescriptionQuery.data?.prescription?.status === "DRAFT" &&
                      therapeuticDraftHasContent(
                        prescriptionQuery.data.prescription.items,
                        prescriptionQuery.data.prescription.generalInstructions,
                      ) && (
                        <li>
                          O registro terapêutico contém rascunho persistido. Finalize ou limpe o
                          conteúdo antes de concluir.
                        </li>
                      )}
                    {pendingPlans && (
                      <li>
                        Há planos vinculados em rascunho. Revise, ative ou arquive antes de
                        concluir.
                      </li>
                    )}
                    {(verificationPending || verificationError) && (
                      <li>
                        {verificationPending
                          ? "Verificando registros clínicos obrigatórios…"
                          : "Não foi possível verificar os registros clínicos. A conclusão está bloqueada."}
                        <button
                          type="button"
                          className="ml-2 underline text-primary"
                          onClick={() => {
                            void documentsQuery.refetch();
                            void prescriptionQuery.refetch();
                            void requestLifecycleQuery.refetch();
                          }}
                        >
                          Tentar novamente
                        </button>
                      </li>
                    )}
                    <li>
                      {laboratoryFilesQuery.error
                        ? "Não foi possível verificar os arquivos de exames."
                        : laboratoryFilesQuery.isPending
                          ? "Consultando arquivos de exames…"
                          : `${laboratoryFilesQuery.data?.documents.filter((item) => item.laboratoryStatus && item.laboratoryStatus !== "VALIDATED").length ?? 0} arquivo(s) de exames aguardando processamento ou revisão${(laboratoryFilesQuery.data?.total ?? 0) > encounterReviewDocumentLimit ? ` (nos primeiros ${encounterReviewDocumentLimit} de ${laboratoryFilesQuery.data?.total} arquivos; consulte Exames para os demais)` : ""}.`}{" "}
                      Exames podem ser acompanhados após o atendimento; esta pendência não bloqueia
                      a conclusão.{" "}
                      <button
                        type="button"
                        className="underline text-primary"
                        onClick={() => navigateStep("exams")}
                      >
                        Conferir exames
                      </button>
                    </li>
                    {documentsQuery.data && !documentsQuery.error && (
                      <li>
                        {completedDocuments.length} documento(s) finalizado(s) neste atendimento.
                      </li>
                    )}
                    <li>
                      Confira alergias, autoria, orientações e os documentos antes da conclusão.
                    </li>
                  </ul>
                </section>
                <div id="orcamento">
                  <EncounterQuoteCard appointmentId={appointmentId} />
                </div>
                {canComplete && (
                  <p className="text-xs text-muted-foreground">
                    Use “Concluir atendimento” na barra superior após a conferência. A ação mantém
                    as validações clínicas e operacionais. Prescrição e exames são opcionais;
                    rascunhos clínicos com conteúdo e planos vinculados precisam ser resolvidos.
                    Contêineres vazios não representam prescrição ou solicitação pendente.
                  </p>
                )}
              </div>
            </main>
            <div hidden={activeStep !== "anamnesis"} className="encounter-context-column min-w-0">
              <EncounterContextPanel
                patientId={appointment.patientId}
                unitId={appointment.unitId}
                onNavigate={navigateContext}
                onCollapseChange={setContextCollapsed}
                active={activeStep === "anamnesis"}
                quickNotes={
                  <label className="block space-y-2 text-xs text-muted-foreground">
                    Anotações de conduta — salvas com evolução
                    <Textarea
                      id="conduta"
                      aria-label="Conduta"
                      value={conduct}
                      onChange={(event) => setConduct(event.target.value)}
                      disabled={
                        !data.canAuthorClinicalNote || data.clinicalNote?.status === "FINAL"
                      }
                      rows={4}
                      maxLength={10000}
                      placeholder="Adicionar anotação clínica…"
                      className="min-h-20 text-xs"
                    />
                  </label>
                }
                onQuickNote={() => {
                  navigateStep("anamnesis");
                  requestAnimationFrame(() => editorRef.current?.focus());
                }}
              />
            </div>
          </div>
        </div>
      </div>
      <Dialog
        open={documentsOpen}
        onOpenChange={(open) => {
          if (
            !open &&
            !window.dispatchEvent(
              new CustomEvent("allik:before-clinical-file-close", {
                cancelable: true,
                detail: { patientId: appointment.patientId },
              }),
            )
          )
            return;
          setDocumentsOpen(open);
        }}
      >
        <DialogContent
          onScroll={(event) => {
            documentsScroll.current = event.currentTarget.scrollTop;
          }}
          onOpenAutoFocus={() => {
            requestAnimationFrame(() => {
              const dialog = document.getElementById("encounter-documents-dialog");
              if (dialog) dialog.scrollTop = documentsScroll.current;
            });
          }}
          id="encounter-documents-dialog"
          className="clinical-workspace max-h-[90dvh] overflow-y-auto sm:max-w-[min(1240px,94vw)]"
        >
          <DialogHeader>
            <DialogTitle>Documentos do paciente</DialogTitle>
            <DialogDescription>
              Arquivos, documentos clínicos e originais associados a este paciente.
            </DialogDescription>
          </DialogHeader>
          <PatientDocumentCenter
            patientId={appointment.patientId}
            unitId={appointment.unitId}
            active={documentsOpen}
            viewState={documentsViewState}
          />
        </DialogContent>
      </Dialog>
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>Histórico longitudinal do paciente</DialogTitle>
            <DialogDescription>Consulta somente leitura sem sair do atendimento.</DialogDescription>
          </DialogHeader>
          <PatientTimelinePage
            patientId={appointment.patientId}
            unitId={appointment.unitId}
            embedded
          />
        </DialogContent>
      </Dialog>
      <Dialog open={vitalsOpen} onOpenChange={setVitalsOpen}>
        <DialogContent className="clinical-workspace max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Sinais vitais do atendimento</DialogTitle>
            <DialogDescription>
              As alterações são incluídas no rascunho da evolução e ficam sujeitas às mesmas regras
              de autoria.
            </DialogDescription>
          </DialogHeader>
          <VitalsSection
            vitals={vitals}
            setVitals={setVitals}
            disabled={!data.canAuthorClinicalNote || data.clinicalNote?.status === "FINAL"}
          />
        </DialogContent>
      </Dialog>
      <Dialog open={allergiesOpen} onOpenChange={setAllergiesOpen}>
        <DialogContent className="clinical-workspace max-h-[90dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Alergias e alertas ativos</DialogTitle>
            <DialogDescription>Confira os dados registrados antes de prescrever.</DialogDescription>
          </DialogHeader>
          {data.allergySummary && (
            <PatientAllergySummary
              patientId={appointment.patientId}
              summary={data.allergySummary}
            />
          )}
          {data.clinicalAlerts.map((item) => (
            <article key={item.id} className="rounded-lg border p-3 text-sm">
              <strong>{item.title}</strong>
              <span className="ml-2 text-xs text-muted-foreground">
                {item.severity === "SEVERE"
                  ? "Grave"
                  : item.severity === "MODERATE"
                    ? "Moderada"
                    : item.severity === "MILD"
                      ? "Leve"
                      : "Gravidade não informada"}
              </span>
              {item.reaction && <p className="mt-1">Reação: {item.reaction}</p>}
              {item.notes && <p className="mt-1 text-muted-foreground">{item.notes}</p>}
            </article>
          ))}
        </DialogContent>
      </Dialog>
      <Dialog open={questionnairesOpen} onOpenChange={setQuestionnairesOpen}>
        <DialogContent className="clinical-workspace max-h-[90dvh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Questionários e tarefas do atendimento</DialogTitle>
            <DialogDescription>
              Respostas declaradas pelo paciente e acompanhamento vinculado ao atendimento.
            </DialogDescription>
          </DialogHeader>
          <PreconsultationPanel
            key={`pre-${appointmentId}`}
            patientId={appointment.patientId}
            appointmentId={appointmentId}
            unitId={appointment.unitId}
          />
          <CareTasksPanel
            key={appointmentId}
            unitId={appointment.unitId}
            patientId={appointment.patientId}
            appointmentId={appointmentId}
            returnOn={clinicalClosure.returnOn}
          />
        </DialogContent>
      </Dialog>
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="clinical-workspace max-h-[90dvh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Contexto e histórico do atendimento</DialogTitle>
            <DialogDescription>
              Dados do agendamento, autoria, tratamentos e acompanhamento do paciente.
            </DialogDescription>
          </DialogHeader>
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
        </DialogContent>
      </Dialog>
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
