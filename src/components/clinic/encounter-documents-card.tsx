import { PrescriptionComposer } from "./prescription-composer";
import "./encounter-document-workspace.css";
import { DocumentDelivery } from "./document-delivery";
import { ClinicalDocumentVerification } from "./clinical-document-verification";
import { allergyLabel, type AllergySummary } from "@/lib/patient-allergies";
import {
  FileText,
  Plus,
  Printer,
  ChevronDown,
  History,
  MoreHorizontal,
  Maximize2,
  Minimize2,
  Search,
  Pill,
  ClipboardList,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { readInventoryResponse, useInventory } from "@/data/inventory-api";
import {
  documentTypes,
  documentTitles,
  plainTextRichContent,
  type DocumentType,
  type RichContentNode,
} from "@/lib/clinical-document-content";
import { InventoryState } from "./inventory-state";
import { ClinicalDocumentEditor } from "./clinical-document-editor";
import { DocumentSignatureActions } from "./document-signature-actions";

import type { TherapeuticPrescriptionSource } from "@/data/encounter-prescription";
import type { PrescriptionPrintData } from "@/lib/prescription-print-data";
const emptyPrintData: PrescriptionPrintData = {
  kind: "SIMPLE",
  patientDocument: "",
  patientAddress: "",
  patientAge: null,
  patientSex: "",
  issuerAddress: "",
  issuerPhone: "",
  issuerCity: "",
  issuerState: "",
};
type ClinicalDocument = {
  id: string;
  type: DocumentType;
  title: string;
  content: string;
  richContent?: RichContentNode | null;
  twoCopies?: boolean;
  prescriptionPrintData?: PrescriptionPrintData | null;
  status: "DRAFT" | "FINAL";
  version: number;
  authorName: string;
  professionalCouncil: string;
  councilNumber: string;
  councilRegion: string;
  canEdit?: boolean;
  canShare?: boolean;
  canAmend?: boolean;
  verificationCode?: string | null;
  contentSha256?: string | null;
  integrityRecordedAt?: string | null;
  integrityVerified?: boolean | null;
  artifactPreserved?: boolean;
  prescriptionSource?: TherapeuticPrescriptionSource | null;
  finalPreview?: {
    patientName: string;
    unitName: string;
    title: string;
    content: string;
    authorName: string;
    professionalCouncil: string;
    councilNumber: string;
    councilRegion: string;
  } | null;
  amendment?: {
    parentDocumentId: string;
    kind: "ADDENDUM" | "RECTIFICATION";
    reason: string;
    parentSha256: string;
  } | null;
};
type Template = {
  id: string;
  type: DocumentType;
  title: string;
  content: string;
  richContent?: RichContentNode | null;
};
type Payload = {
  documents: ClinicalDocument[];
  templates: Template[];
  canAuthor: boolean;
  allowedDocumentTypes?: DocumentType[];
  context?: {
    patientName: string;
    birthDate: string | null;
    unitName: string;
    allergies: string[] | null;
    allergySummary?: AllergySummary;
    prescriptionPrintData?: PrescriptionPrintData;
  };
};
type Buffer = {
  content: string;
  richContent: RichContentNode | null;
  twoCopies: boolean;
  prescriptionPrintData: PrescriptionPrintData | null;
  dirty: boolean;
  prescriptionSource: TherapeuticPrescriptionSource | null;
  version: number;
};
const labels: Record<DocumentType, string> = {
  PRESCRIPTION: "Receita médica",
  EXAM_REQUEST: "Solicitação de exames",
  MEDICAL_CERTIFICATE: "Atestado",
  REFERRAL: "Encaminhamento",
  MEDICAL_REPORT: "Relatório médico",
  MEDICAL_OPINION: "Laudo médico",
  INSTRUCTIONS: "Orientações",
};
const tabLabels: Record<DocumentType, string> = {
  PRESCRIPTION: "Receita",
  EXAM_REQUEST: "Exames",
  MEDICAL_CERTIFICATE: "Atestado",
  REFERRAL: "Encaminhamento",
  MEDICAL_REPORT: "Relatório",
  MEDICAL_OPINION: "Laudo",
  INSTRUCTIONS: "Orientações",
};
type PrescriptionCategory =
  "medications" | "manipulated" | "injectables" | "supplements" | "instructions" | "models";
type MedicationControls = {
  onInsert: (text: string, source?: TherapeuticPrescriptionSource) => void;
  canInsert: boolean;
  search: string;
};
type RequestCategory = "EXAM_REQUEST" | "REFERRAL" | "PROCEDURE" | "DOCUMENTS";
function matchesRequestCategory(type: DocumentType, category: RequestCategory) {
  return category === "DOCUMENTS"
    ? !["PRESCRIPTION", "EXAM_REQUEST", "REFERRAL"].includes(type)
    : type === category;
}
function initialBuffer(document: ClinicalDocument): Buffer {
  return {
    content: document.content,
    richContent: document.richContent ?? null,
    twoCopies: document.twoCopies ?? false,
    prescriptionPrintData: document.prescriptionPrintData ?? null,
    dirty: false,
    prescriptionSource: document.prescriptionSource ?? null,
    version: document.version,
  };
}
function samePersistedValue(left: unknown, right: unknown) {
  const canonical = (value: unknown) =>
    JSON.stringify(value, (_key, item: unknown) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return item;
      return Object.fromEntries(
        Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
      );
    });
  return canonical(left) === canonical(right);
}
function ageFromDate(value: string | null | undefined) {
  if (!value) return null;
  const birth = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  return (
    now.getFullYear() -
    birth.getFullYear() -
    (now.getMonth() < birth.getMonth() ||
    (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())
      ? 1
      : 0)
  );
}

export function EncounterDocumentsCard({
  appointmentId,
  mode = "all",
  procedures,
  medications,
  onDraftStateChange,
}: {
  appointmentId: string;
  mode?: "all" | "prescription" | "requests";
  procedures?: ReactNode;
  medications?: ReactNode | ((controls: MedicationControls) => ReactNode);
  onDraftStateChange?: (state: { dirty: boolean; pending: boolean }) => void;
}) {
  const query = useInventory<Payload>(
    `encounter-documents?appointmentId=${encodeURIComponent(appointmentId)}`,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [buffers, setBuffers] = useState<Record<string, Buffer>>({});
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [focusId, setFocusId] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [templateForm, setTemplateForm] = useState(false);
  const [applying, setApplying] = useState<Template | null>(null);
  const [amendmentKind, setAmendmentKind] = useState<"ADDENDUM" | "RECTIFICATION" | null>(null);
  const [amendmentReason, setAmendmentReason] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [printDataOpen, setPrintDataOpen] = useState(false);
  const [verificationOpen, setVerificationOpen] = useState(false);
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerState, setComposerState] = useState({ dirty: false, pending: false });
  const [documentSearch, setDocumentSearch] = useState("");
  const [prescriptionCategory, setPrescriptionCategory] =
    useState<PrescriptionCategory>("medications");
  const initialShowRecipeEditor = useRef(!medications);
  const [showRecipeEditor, setShowRecipeEditor] = useState(initialShowRecipeEditor.current);
  const [showRequestEditor, setShowRequestEditor] = useState(false);
  const [requestType, setRequestType] = useState<RequestCategory>("EXAM_REQUEST");
  const [contextOpen, setContextOpen] = useState(true);
  const lastSelection = useRef<Partial<Record<typeof mode, string>>>({});
  useEffect(() => {
    if (!expanded) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEscape);
    };
  }, [expanded]);
  const submitting = useRef(false);
  const pendingCreations = useRef<Partial<Record<DocumentType, string>>>({});
  const editorRef = useRef<Editor | null>(null);
  const onEditorReady = useCallback((editor: Editor | null) => {
    editorRef.current = editor;
  }, []);
  const allowedTypes = query.data?.allowedDocumentTypes ?? documentTypes;
  const modeTypes = allowedTypes.filter((type) =>
    mode === "prescription"
      ? type === (prescriptionCategory === "instructions" ? "INSTRUCTIONS" : "PRESCRIPTION")
      : mode === "requests"
        ? matchesRequestCategory(type, requestType)
        : true,
  );
  const isInMode = (type: DocumentType) =>
    mode === "prescription"
      ? type === (prescriptionCategory === "instructions" ? "INSTRUCTIONS" : "PRESCRIPTION")
      : mode === "requests"
        ? type !== "PRESCRIPTION"
        : true;
  const selected = query.data?.documents.find(
    (item) =>
      item.id === selectedId &&
      isInMode(item.type) &&
      (mode !== "requests" ||
        requestType === "PROCEDURE" ||
        matchesRequestCategory(item.type, requestType)),
  );
  const buffer = selected
    ? (buffers[selected.id] ?? {
        ...initialBuffer(selected),
        prescriptionPrintData:
          selected.type === "PRESCRIPTION"
            ? (selected.prescriptionPrintData ??
              (selected.status === "DRAFT" ? query.data?.context?.prescriptionPrintData : null) ??
              null)
            : null,
      })
    : null;
  const readonly =
    (!query.data?.canAuthor && selected?.canEdit !== true) ||
    selected?.status === "FINAL" ||
    selected?.canEdit === false;
  useEffect(() => {
    setSelectedId(null);
    setBuffers({});
    setMessage("");
    setError("");
    setFocusId(null);
    setDocumentSearch("");
    setPrescriptionCategory("medications");
    setShowRecipeEditor(initialShowRecipeEditor.current);
    setShowRequestEditor(false);
    setRequestType("EXAM_REQUEST");
    lastSelection.current = {};
    pendingCreations.current = {};
    setComposerOpen(false);
    setComposerState({ dirty: false, pending: false });
  }, [appointmentId]);
  useEffect(() => {
    const documents = query.data?.documents.filter((item) =>
      mode === "prescription"
        ? item.type === (prescriptionCategory === "instructions" ? "INSTRUCTIONS" : "PRESCRIPTION")
        : mode === "requests"
          ? item.type !== "PRESCRIPTION" &&
            (requestType === "PROCEDURE" || matchesRequestCategory(item.type, requestType))
          : true,
    );
    if (!documents?.length) {
      setSelectedId(null);
      return;
    }
    if (documents.some((item) => item.id === selectedId)) return;
    const callbackId = new URL(window.location.href).searchParams.get("signatureDocumentId");
    const next =
      documents.find((item) => item.id === callbackId) ??
      documents.find((item) => item.id === lastSelection.current[mode]) ??
      documents[0];
    setSelectedId(next!.id);
  }, [mode, prescriptionCategory, requestType, query.data, selectedId]);
  const hasUnsavedDocuments =
    Object.values(buffers).some((item) => item.dirty) || composerState.dirty;
  useEffect(() => {
    onDraftStateChange?.({ dirty: hasUnsavedDocuments, pending: pending || composerState.pending });
  }, [hasUnsavedDocuments, pending, composerState.pending, onDraftStateChange]);
  useEffect(() => {
    if (!hasUnsavedDocuments) return;
    const prevent = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [hasUnsavedDocuments]);
  function update(values: Partial<Buffer>) {
    if (!selected || readonly || pending) return;
    setBuffers((previous) => ({
      ...previous,
      [selected.id]: {
        ...(previous[selected.id] ?? buffer ?? initialBuffer(selected)),
        ...values,
        dirty: true,
      },
    }));
    setMessage("");
  }
  function select(id: string) {
    if (pending) return;
    setSelectedId(id);
    lastSelection.current[mode] = id;
    setError("");
    setMessage("");
  }
  async function request(body: Record<string, unknown>) {
    const response = await fetch("/api/v1/inventory/encounter-documents", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appointmentId, ...body }),
    });
    return readInventoryResponse<{ id: string; version: number }>(
      response,
      "Não foi possível salvar o documento.",
    );
  }
  async function create(type: DocumentType) {
    if (
      submitting.current ||
      composerState.dirty ||
      composerState.pending ||
      !query.data?.canAuthor ||
      !allowedTypes.includes(type)
    )
      return;
    submitting.current = true;
    setPending(true);
    setError("");
    setMessage("");
    try {
      const creationId = pendingCreations.current[type] ?? crypto.randomUUID();
      pendingCreations.current[type] = creationId;
      const result = await request({
        action: "SAVE_DRAFT",
        documentId: null,
        creationId,
        type,
        title: documentTitles[type],
        content: "",
        richContent: plainTextRichContent(""),
        twoCopies: false,
        version: null,
      });
      if (!result.data) throw new Error("Não foi possível confirmar a criação do documento.");
      await query.refetch();
      setSelectedId(result.data.id);
      if (type === "PRESCRIPTION") {
        setPrescriptionCategory("medications");
        setShowRecipeEditor(true);
      }
      if (type !== "PRESCRIPTION") setShowRequestEditor(true);
      if (mode === "prescription" && type === "INSTRUCTIONS")
        setPrescriptionCategory("instructions");
      if (type !== "PRESCRIPTION")
        setRequestType(type === "EXAM_REQUEST" || type === "REFERRAL" ? type : "DOCUMENTS");
      lastSelection.current[mode] = result.data.id;
      setFocusId(result.data.id);
      delete pendingCreations.current[type];
      setMessage("Rascunho criado.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível criar o documento.");
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }
  async function createAmendment() {
    if (
      submitting.current ||
      composerState.dirty ||
      composerState.pending ||
      !selected?.canAmend ||
      !amendmentKind ||
      amendmentReason.trim().length < 5
    )
      return;
    submitting.current = true;
    setPending(true);
    setError("");
    try {
      const result = await request({
        action: "CREATE_AMENDMENT",
        documentId: selected.id,
        version: selected.version,
        type: selected.type,
        title: `${amendmentKind === "ADDENDUM" ? "ADENDO" : "RETIFICAÇÃO"} — ${documentTitles[selected.type]}`,
        content: "",
        amendmentKind,
        amendmentReason,
        twoCopies: selected.twoCopies ?? false,
        prescriptionPrintData: selected.prescriptionPrintData ?? null,
      });
      if (!result.data) throw new Error("Não foi possível confirmar o novo rascunho.");
      await query.refetch();
      setSelectedId(result.data.id);
      if (selected.type !== "PRESCRIPTION")
        setRequestType(
          selected.type === "EXAM_REQUEST" || selected.type === "REFERRAL"
            ? selected.type
            : "DOCUMENTS",
        );
      lastSelection.current[mode] = result.data.id;
      setFocusId(result.data.id);
      setAmendmentKind(null);
      setAmendmentReason("");
      setMessage("Rascunho vinculado criado. O documento original foi preservado.");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Não foi possível criar o documento vinculado.",
      );
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }
  async function save(action: "SAVE_DRAFT" | "FINALIZE" | "SAVE_TEMPLATE"): Promise<boolean> {
    if (
      submitting.current ||
      composerState.dirty ||
      composerState.pending ||
      readonly ||
      !selected ||
      !buffer
    )
      return false;
    if (action !== "SAVE_DRAFT" && !buffer.content.trim()) {
      setError("Preencha o conteúdo do documento.");
      return false;
    }
    if (action === "SAVE_TEMPLATE" && !templateName.trim()) {
      setError("Informe um nome para o modelo.");
      return false;
    }
    if (
      action === "SAVE_TEMPLATE" &&
      !window.confirm(
        "Remova nomes e demais dados pessoais do paciente antes de salvar este conteúdo como modelo reutilizável. Continuar?",
      )
    )
      return false;
    if (
      action === "FINALIZE" &&
      !window.confirm(
        "Finalizar este documento? O conteúdo ficará imutável. A finalização não equivale a assinatura eletrônica.",
      )
    )
      return false;
    submitting.current = true;
    setPending(true);
    setError("");
    setMessage("");
    try {
      const result = await request({
        action,
        documentId: selected.id,
        type: selected.type,
        title:
          action === "SAVE_TEMPLATE"
            ? templateName.trim()
            : selected.title || documentTitles[selected.type],
        content: buffer.content,
        richContent: buffer.richContent,
        twoCopies: buffer.twoCopies,
        prescriptionPrintData: action === "SAVE_TEMPLATE" ? null : buffer.prescriptionPrintData,
        prescriptionSource: action === "SAVE_TEMPLATE" ? null : buffer.prescriptionSource,
        version: buffer.version,
      });
      if (!result.data) throw new Error("Não foi possível confirmar o salvamento.");
      if (action !== "SAVE_TEMPLATE")
        setBuffers((previous) => ({
          ...previous,
          [selected.id]: { ...buffer, dirty: false, version: result.data!.version },
        }));
      await query.refetch();
      if (action === "SAVE_TEMPLATE") {
        setTemplateForm(false);
        setTemplateName("");
      }
      setMessage(
        action === "FINALIZE"
          ? "Documento finalizado."
          : action === "SAVE_TEMPLATE"
            ? "Modelo salvo para seus próximos atendimentos."
            : "Rascunho salvo.",
      );
      return true;
    } catch (cause) {
      // A lost acknowledgement must not strand the author on an obsolete version.
      // Reconcile only an exact persisted match; never overwrite another session's text.
      if (action !== "SAVE_TEMPLATE") {
        try {
          const refreshed = await query.refetch();
          const persisted = refreshed.data?.documents.find((item) => item.id === selected.id);
          if (
            persisted &&
            persisted.version > buffer.version &&
            persisted.content === buffer.content &&
            samePersistedValue(persisted.richContent ?? null, buffer.richContent) &&
            Boolean(persisted.twoCopies) === buffer.twoCopies &&
            samePersistedValue(
              persisted.prescriptionPrintData ?? null,
              buffer.prescriptionPrintData,
            ) &&
            persisted.status === (action === "FINALIZE" ? "FINAL" : "DRAFT")
          ) {
            setBuffers((previous) => ({ ...previous, [selected.id]: initialBuffer(persisted) }));
            setMessage(
              "Salvamento confirmado após reconferir o servidor. O conteúdo foi preservado.",
            );
            return true;
          }
        } catch {
          /* Keep the unsaved buffer and block navigation when reconciliation is unavailable. */
        }
      }
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível confirmar o salvamento. Seu texto continua preservado; confira a conexão antes de tentar novamente.",
      );
      return false;
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }
  async function print() {
    if (!selected || pending) return;
    if (
      query.data?.documents.some(
        (item) =>
          item.status === "FINAL" &&
          item.amendment?.parentDocumentId === selected.id &&
          item.amendment.kind === "RECTIFICATION",
      ) &&
      !window.confirm(
        "Este documento possui uma retificação finalizada. Deseja visualizar a impressão do original preservado?",
      )
    )
      return;
    // Open synchronously so browsers do not block the preview after saving.
    const preview = window.open("about:blank", "_blank");
    if (preview) preview.opener = null;
    if (buffer?.dirty && !(await save("SAVE_DRAFT"))) {
      preview?.close();
      return;
    }
    const url = `/api/v1/inventory/encounter-documents?documentId=${encodeURIComponent(selected.id)}&print=true${selected.status === "DRAFT" ? "&preview=true" : ""}`;
    if (preview) preview.location.href = url;
    else setError("Permita a abertura de uma nova janela para visualizar a impressão.");
  }
  function apply(template: Template, replace: boolean) {
    if (!editorRef.current || readonly) return;
    if (
      replace &&
      buffer?.content.trim() &&
      !window.confirm("Substituir o conteúdo atual pelo modelo selecionado?")
    )
      return;
    const content = template.richContent ?? plainTextRichContent(template.content);
    if (replace)
      editorRef.current.commands.setContent(
        content as Parameters<Editor["commands"]["setContent"]>[0],
        { emitUpdate: true },
      );
    else
      editorRef.current
        .chain()
        .focus()
        .insertContent(content.content ?? [])
        .run();
    setApplying(null);
    if (mode === "prescription" && selected?.type === "PRESCRIPTION") {
      setPrescriptionCategory("medications");
      setShowRecipeEditor(true);
    }
  }
  function insertMedicationText(text: string, source?: TherapeuticPrescriptionSource) {
    if (
      !selected ||
      selected.type !== "PRESCRIPTION" ||
      !editorRef.current ||
      readonly ||
      pending ||
      !text.trim()
    )
      return;
    if (
      buffer?.content.trim() &&
      !window.confirm(
        "Acrescentar os itens ao final da receita? O conteúdo atual será preservado. Revise para evitar duplicações.",
      )
    )
      return;
    editorRef.current
      .chain()
      .focus()
      .insertContentAt(
        editorRef.current.state.doc.content.size,
        plainTextRichContent(text).content ?? [],
      )
      .run();
    if (source) update({ prescriptionSource: source });
    setMessage(
      "Itens acrescentados à receita. Revise o documento e salve o rascunho; a finalização permanece separada.",
    );
    setShowRecipeEditor(true);
  }
  if (query.isPending || query.error)
    return (
      <InventoryState pending={query.isPending} error={query.error} retry={() => query.refetch()} />
    );
  const data = query.data!;
  const templates = data.templates.filter((item) => item.type === selected?.type);
  const age = ageFromDate(data.context?.birthDate);
  const menuStyle = "clinical-document-glass rounded-2xl border-[rgba(60,60,67,.12)] p-2 shadow-lg";
  const buttonStyle =
    "rounded-xl bg-white border-[rgba(60,60,67,.12)] text-[#1d1d1f] hover:bg-[#f5f5f7]";
  const counts: Partial<Record<DocumentType | "ADDENDUM" | "RECTIFICATION", number>> = {};
  const tabNumbers = new Map<string, number>();
  for (const document of data.documents) {
    const kind = document.amendment?.kind ?? document.type;
    counts[kind] = (counts[kind] ?? 0) + 1;
    tabNumbers.set(document.id, counts[kind]!);
  }
  const normalizedSearch =
    mode === "prescription" && prescriptionCategory === "medications"
      ? ""
      : documentSearch.trim().toLocaleLowerCase("pt-BR");
  const modeDocuments = data.documents.filter((item) => isInMode(item.type));
  const displayedDocuments = [...modeDocuments]
    .reverse()
    .filter(
      (item) =>
        (mode !== "requests" || matchesRequestCategory(item.type, requestType)) &&
        (!normalizedSearch ||
          `${item.title} ${item.content} ${item.authorName}`
            .toLocaleLowerCase("pt-BR")
            .includes(normalizedSearch)),
    );
  const workspace = mode !== "all";
  const workspaceTemplates = data.templates.filter(
    (item) =>
      isInMode(item.type) &&
      (mode !== "requests" || matchesRequestCategory(item.type, requestType)) &&
      (!normalizedSearch ||
        `${item.title} ${item.content}`.toLocaleLowerCase("pt-BR").includes(normalizedSearch)),
  );
  return (
    <section
      className={`clinical-documents${workspace ? " encounter-document-workspace" : ""}${expanded ? " clinical-documents-expanded" : ""}`}
      data-document-mode={mode}
      data-context-open={contextOpen}
      aria-label="Documentos do atendimento"
    >
      {!workspace && data.context && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-white px-5 py-3 text-sm">
          <p className="font-semibold">
            Allik One <span className="font-normal text-[#636366]">· {data.context.unitName}</span>
          </p>
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            <span>
              {selected?.status === "FINAL"
                ? selected.finalPreview?.patientName || "Identificação legada: consulte a impressão"
                : data.context.patientName}
              {age !== null ? ` · ${age} anos` : ""}
            </span>
            {data.context.allergySummary?.status === "REPORTED" &&
            data.context.allergySummary.allergies.length ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-sm font-medium text-red-700"
                    aria-label="Ver alergias relatadas"
                  >
                    {allergyLabel(data.context.allergySummary).length > 90
                      ? `Alergias relatadas (${data.context.allergySummary.allergies.length})`
                      : allergyLabel(data.context.allergySummary)}
                    <ChevronDown size={14} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="max-h-64 max-w-[min(360px,90vw)] overflow-y-auto rounded-2xl bg-white p-3">
                  <p className="mb-2 text-sm font-semibold text-red-700">Alergias relatadas</p>
                  <ul className="space-y-2 text-sm">
                    {data.context.allergySummary.allergies.map((name) => (
                      <li key={name} className="break-words">
                        {name}
                      </li>
                    ))}
                  </ul>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <span className="text-[#636366]">
                {data.context.allergySummary
                  ? allergyLabel(data.context.allergySummary)
                  : data.context.allergies?.length
                    ? `Alergias: ${data.context.allergies.join(", ")}`
                    : "Alergias: não informadas"}
              </span>
            )}
          </div>
        </div>
      )}
      <div className="bg-white px-4 pb-1 pt-3 sm:px-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {workspace && (
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-teal-50 text-teal-700">
                {mode === "prescription" ? <Pill size={21} /> : <ClipboardList size={21} />}
              </span>
            )}
            <div>
              <h2 className="text-lg font-semibold tracking-tight">
                {mode === "prescription"
                  ? "Prescrição médica"
                  : mode === "requests"
                    ? "Solicitações do atendimento"
                    : "Documentos deste atendimento"}
              </h2>
              {workspace && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {mode === "prescription"
                    ? "Medicamentos, manipulados, injetáveis e protocolos"
                    : "Exames, encaminhamentos e documentos clínicos"}
                </p>
              )}
            </div>
          </div>
          {workspace && (
            <Button
              size="sm"
              variant="ghost"
              aria-label={
                contextOpen ? "Recolher painel do documento" : "Abrir painel do documento"
              }
              aria-expanded={contextOpen}
              onClick={() => setContextOpen((open) => !open)}
            >
              {contextOpen ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}
            </Button>
          )}
        </div>
        {workspace && (
          <div className="mb-3 space-y-3">
            {mode === "prescription" && (
              <div className="flex flex-wrap gap-1 border-b" aria-label="Categorias de prescrição">
                {(
                  [
                    ["medications", "Medicamentos"],
                    ["manipulated", "Manipulados"],
                    ["injectables", "Injetáveis"],
                    ["supplements", "Suplementos"],
                    ["instructions", "Orientações"],
                    ["models", "Modelos"],
                  ] as const
                ).map(([category, label]) => (
                  <button
                    key={category}
                    type="button"
                    className={`border-b-2 px-3 py-2 text-xs font-medium ${prescriptionCategory === category ? "border-teal-600 text-teal-700" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                    aria-pressed={prescriptionCategory === category}
                    onClick={() => {
                      setPrescriptionCategory(category);
                      setDocumentSearch("");
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            {mode === "requests" && (
              <div
                className="flex flex-wrap gap-1 border-b"
                aria-label="Categorias de solicitações"
              >
                {[
                  { type: "EXAM_REQUEST" as const, label: "Exames laboratoriais" },
                  { type: "REFERRAL" as const, label: "Encaminhamentos" },
                  ...(procedures ? [{ type: "PROCEDURE" as const, label: "Procedimentos" }] : []),
                  { type: "DOCUMENTS" as const, label: "Documentos" },
                ].map((category) => (
                  <button
                    key={category.type}
                    type="button"
                    aria-pressed={requestType === category.type}
                    className={`border-b-2 px-3 py-2 text-xs font-medium ${requestType === category.type ? "border-teal-600 text-teal-700" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                    onClick={() => {
                      setRequestType(category.type);
                      setShowRequestEditor(false);
                      const first = modeDocuments.find((item) =>
                        matchesRequestCategory(item.type, category.type),
                      );
                      if (first) select(first.id);
                    }}
                  >
                    {category.label}
                  </button>
                ))}
              </div>
            )}
            <label className="relative block max-w-lg">
              <Search
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                className="h-9 bg-white pl-9 text-sm"
                aria-label={
                  mode === "prescription"
                    ? prescriptionCategory === "medications" && medications
                      ? "Buscar medicamento ou tratamento"
                      : "Buscar receita ou modelo"
                    : "Buscar solicitação ou modelo"
                }
                placeholder={
                  mode === "prescription"
                    ? prescriptionCategory === "medications" && medications
                      ? "Buscar medicamento ou tratamento…"
                      : "Buscar receita ou modelo…"
                    : "Buscar solicitação ou modelo…"
                }
                value={documentSearch}
                onChange={(event) => setDocumentSearch(event.target.value)}
              />
            </label>
          </div>
        )}
        <div className="flex min-w-0 flex-wrap items-start gap-2">
          {mode === "requests" && showRequestEditor && (
            <Button size="sm" variant="outline" onClick={() => setShowRequestEditor(false)}>
              Voltar às solicitações
            </Button>
          )}
          {mode === "prescription" && prescriptionCategory === "medications" && medications && (
            <Button
              size="sm"
              variant="outline"
              disabled={!selected}
              onClick={() => setShowRecipeEditor((value) => !value)}
            >
              {showRecipeEditor ? "Voltar aos medicamentos" : "Editar receita"}
            </Button>
          )}
          <div
            className="clinical-document-tabs min-w-0 flex-1"
            role="tablist"
            aria-label="Documentos deste atendimento"
          >
            {displayedDocuments.map((item) => {
              return (
                <button
                  type="button"
                  key={item.id}
                  id={`document-tab-${item.id}`}
                  role="tab"
                  aria-selected={selectedId === item.id}
                  tabIndex={selectedId === item.id ? 0 : -1}
                  aria-controls={`document-panel-${item.id}`}
                  disabled={pending}
                  onClick={() => {
                    select(item.id);
                    if (mode === "requests") setShowRequestEditor(true);
                    else setShowRecipeEditor(true);
                  }}
                  onKeyDown={(event) => {
                    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
                    event.preventDefault();
                    const index = displayedDocuments.findIndex(
                      (document) => document.id === item.id,
                    );
                    const nextIndex =
                      event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? displayedDocuments.length - 1
                          : (index +
                              (event.key === "ArrowRight" ? 1 : -1) +
                              displayedDocuments.length) %
                            displayedDocuments.length;
                    select(displayedDocuments[nextIndex]!.id);
                    document
                      .getElementById(`document-tab-${displayedDocuments[nextIndex]!.id}`)
                      ?.focus();
                  }}
                >
                  <span className="text-sm font-medium">
                    {item.amendment
                      ? item.amendment.kind === "ADDENDUM"
                        ? "Adendo"
                        : "Retificação"
                      : tabLabels[item.type]}{" "}
                    {tabNumbers.get(item.id)}
                  </span>
                  <span className="ml-2 text-[11px] text-[#636366]">
                    {item.status === "FINAL"
                      ? "Finalizado"
                      : buffers[item.id]?.dirty
                        ? "Não salvo"
                        : "Rascunho"}
                  </span>
                </button>
              );
            })}
          </div>
          {data.canAuthor && modeTypes.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className={`${buttonStyle} ${workspace ? "!border-teal-700 !bg-teal-700 !text-white hover:!bg-teal-800" : "text-[#007aff]"}`}
                  disabled={pending}
                >
                  <Plus size={16} />
                  Novo documento
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className={menuStyle}>
                {modeTypes.map((type) => (
                  <DropdownMenuItem key={type} onSelect={() => void create(type)}>
                    <FileText size={16} />
                    {labels[type]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
      {(message || error) && (
        <div className="px-4 pt-1 sm:px-5">
          <p
            role={error ? "alert" : "status"}
            className={`rounded-xl bg-white px-3 py-1 text-sm ${error ? "text-red-700" : "text-[#636366]"}`}
          >
            {error || message}
            {error && selected && !readonly && (
              <button
                type="button"
                className="ml-3 font-medium text-[#007aff]"
                disabled={pending}
                onClick={() => void save("SAVE_DRAFT")}
              >
                Tentar novamente
              </button>
            )}
          </p>
        </div>
      )}
      <div className={workspace ? "encounter-document-columns" : "contents"}>
        <div className={workspace ? "encounter-document-main" : "contents"}>
          {mode === "requests" && requestType !== "PROCEDURE" && !showRequestEditor && (
            <div className="min-h-0 flex-1 overflow-auto p-4">
              <h3 className="mb-3 text-sm font-semibold">Solicitações deste atendimento</h3>
              {displayedDocuments.length ? (
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        <th className="px-3 py-3 font-medium">Documento</th>
                        <th className="px-3 py-3 font-medium">Tipo</th>
                        <th className="px-3 py-3 font-medium">Estado</th>
                        <th className="px-3 py-3 font-medium">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayedDocuments.map((item) => (
                        <tr key={item.id} className="border-t border-slate-100">
                          <td className="px-3 py-3">
                            <span className="block font-medium">{item.title}</span>
                            <span className="mt-1 block text-muted-foreground">
                              {item.authorName}
                            </span>
                          </td>
                          <td className="px-3 py-3">{labels[item.type]}</td>
                          <td className="px-3 py-3">
                            <span
                              className={`rounded-full px-2 py-1 text-[11px] ${item.status === "FINAL" ? "bg-teal-50 text-teal-700" : "bg-slate-100 text-slate-600"}`}
                            >
                              {item.status === "FINAL"
                                ? "Finalizado"
                                : buffers[item.id]?.dirty
                                  ? "Não salvo"
                                  : "Rascunho"}
                            </span>
                          </td>
                          <td className="px-3 py-3">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-teal-700"
                              onClick={() => {
                                select(item.id);
                                setShowRequestEditor(true);
                              }}
                            >
                              {item.status === "FINAL" || item.canEdit === false
                                ? "Visualizar"
                                : "Editar"}
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="rounded-lg bg-muted/30 p-4 text-sm text-muted-foreground">
                  {data.canAuthor && modeTypes.length > 0
                    ? "Nenhuma solicitação nesta categoria. Use Novo documento para adicionar uma solicitação autorizada."
                    : "Nenhuma solicitação nesta categoria. A inclusão depende do profissional responsável e das permissões de emissão."}
                </p>
              )}
            </div>
          )}
          {medications && (
            <div
              hidden={
                mode !== "prescription" ||
                prescriptionCategory !== "medications" ||
                showRecipeEditor
              }
              className="min-h-0 flex-1 overflow-auto p-3"
            >
              {typeof medications === "function"
                ? medications({
                    onInsert: insertMedicationText,
                    canInsert: Boolean(selected?.type === "PRESCRIPTION" && !readonly && !pending),
                    search: documentSearch,
                  })
                : medications}
            </div>
          )}
          {mode === "prescription" &&
            ["manipulated", "injectables", "supplements"].includes(prescriptionCategory) && (
              <div className="space-y-4 p-5">
                <h3 className="font-semibold">
                  Compositor avançado ·{" "}
                  {
                    (
                      {
                        manipulated: "Manipulados",
                        injectables: "Injetáveis",
                        supplements: "Suplementos",
                      } as Record<string, string>
                    )[prescriptionCategory]
                  }
                </h3>
                <p className="max-w-xl text-sm leading-6 text-muted-foreground">
                  Defina componentes, quantidade, unidade e posologia no motor de composição
                  existente. Esta seção não classifica automaticamente itens nem preenche doses ou
                  vias.
                </p>
                <Button
                  disabled={!selected || readonly || pending}
                  onClick={() => setComposerOpen(true)}
                >
                  Abrir compositor avançado
                </Button>
                {!selected && (
                  <p className="text-xs text-muted-foreground">
                    Crie uma receita em Novo documento para iniciar a composição.
                  </p>
                )}
              </div>
            )}
          {mode === "prescription" && prescriptionCategory === "models" && (
            <div className="min-h-0 flex-1 space-y-4 overflow-auto p-5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-semibold">Biblioteca de modelos</h3>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!selected || readonly || pending}
                  onClick={() => setComposerOpen(true)}
                >
                  Abrir protocolos
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Modelos de receitas autorizados e protocolos do compositor. Nenhum esquema clínico é
                selecionado automaticamente.
              </p>
              {workspaceTemplates.length ? (
                workspaceTemplates.map((template) => (
                  <div
                    key={template.id}
                    className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm"
                  >
                    <span>{template.title}</span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={readonly || pending || selected?.type !== template.type}
                      onClick={() =>
                        buffer?.content.trim() ? setApplying(template) : apply(template, true)
                      }
                    >
                      Usar modelo
                    </Button>
                  </div>
                ))
              ) : (
                <p className="rounded-lg bg-muted/40 p-4 text-sm text-muted-foreground">
                  Nenhum modelo de receita salvo. Os protocolos pessoais e compartilhados estão em
                  Abrir protocolos.
                </p>
              )}
            </div>
          )}
          {procedures && (
            <div
              hidden={mode !== "requests" || requestType !== "PROCEDURE"}
              className="min-h-0 flex-1 overflow-auto p-4"
            >
              {procedures}
            </div>
          )}
          <div
            className={
              (mode === "requests" && (requestType === "PROCEDURE" || !showRequestEditor)) ||
              (mode === "prescription" &&
                ((prescriptionCategory === "medications" && medications && !showRecipeEditor) ||
                  ["manipulated", "injectables", "supplements", "models"].includes(
                    prescriptionCategory,
                  )))
                ? "hidden"
                : "contents"
            }
          >
            {!selected || !buffer ? (
              <div className="px-6 py-12 text-sm text-[#636366]">
                {data.canAuthor && modeTypes.length > 0
                  ? "Escolha um tipo de documento autorizado para iniciar."
                  : "Nenhum documento disponível. A elaboração exige o profissional responsável pelo atendimento."}
              </div>
            ) : (
              <div
                id={`document-panel-${selected.id}`}
                role="tabpanel"
                className="clinical-document-panel"
                aria-labelledby={
                  displayedDocuments.some((item) => item.id === selected.id)
                    ? `document-tab-${selected.id}`
                    : undefined
                }
                aria-label={
                  displayedDocuments.some((item) => item.id === selected.id)
                    ? undefined
                    : selected.title
                }
              >
                {data.documents.some(
                  (item) =>
                    item.status === "FINAL" && item.amendment?.parentDocumentId === selected.id,
                ) && (
                  <details className="mx-4 mt-2 rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-[#1d1d1f]">
                    <summary className="cursor-pointer font-medium">
                      Este documento possui adendo ou retificação finalizados
                    </summary>
                    {data.documents
                      .filter(
                        (item) =>
                          item.status === "FINAL" &&
                          item.amendment?.parentDocumentId === selected.id,
                      )
                      .map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className="mt-2 block text-[#007aff]"
                          onClick={() => select(item.id)}
                        >
                          {item.title}
                        </button>
                      ))}
                  </details>
                )}
                {selected.amendment && (
                  <details className="mx-4 mt-2 rounded-xl border bg-white p-3 text-xs text-[#636366]">
                    <summary className="cursor-pointer font-medium">
                      {selected.amendment.kind === "ADDENDUM" ? "Adendo" : "Retificação"} ·
                      documento vinculado
                    </summary>
                    <p className="mt-2">Motivo: {selected.amendment.reason}</p>
                    <button
                      type="button"
                      className="mt-2 text-[#007aff]"
                      onClick={() => select(selected.amendment!.parentDocumentId)}
                    >
                      Abrir documento original
                    </button>
                  </details>
                )}
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 sm:px-5">
                  <div className="flex flex-wrap gap-2">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="outline"
                          className={buttonStyle}
                          disabled={readonly || pending}
                        >
                          {workspace ? "Modelos do documento" : "Modelos"}
                          <ChevronDown size={15} />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className={`${menuStyle} max-w-[300px]`}>
                        {templates.length ? (
                          templates.map((template) => (
                            <DropdownMenuItem
                              key={template.id}
                              onSelect={() =>
                                buffer.content.trim()
                                  ? setApplying(template)
                                  : apply(template, true)
                              }
                            >
                              {template.title}
                            </DropdownMenuItem>
                          ))
                        ) : (
                          <p className="px-3 py-2 text-sm text-[#636366]">
                            Nenhum modelo salvo para este tipo.
                          </p>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <Button
                      variant="outline"
                      className={buttonStyle}
                      onClick={() => setHistoryOpen(true)}
                    >
                      <History size={16} />
                      Histórico
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {selected.canShare && (
                      <Button
                        variant="outline"
                        className={buttonStyle}
                        onClick={() => setDeliveryOpen(true)}
                      >
                        Enviar receita
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      className={buttonStyle}
                      disabled={
                        pending ||
                        selected.integrityVerified === false ||
                        (selected.status === "DRAFT" && readonly)
                      }
                      onClick={() => void print()}
                    >
                      <Printer size={16} />
                      Visualizar impressão
                    </Button>
                    <Button
                      variant="outline"
                      className={buttonStyle}
                      aria-label={expanded ? "Recolher editor" : "Expandir editor"}
                      aria-pressed={expanded}
                      onClick={() => setExpanded((value) => !value)}
                    >
                      {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                      <span className="hidden sm:inline">{expanded ? "Recolher" : "Expandir"}</span>
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="outline"
                          className={buttonStyle}
                          aria-label="Opções do documento"
                        >
                          <MoreHorizontal size={18} />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className={menuStyle}>
                        <DropdownMenuItem onSelect={() => setVerificationOpen(true)}>
                          Verificar documento
                        </DropdownMenuItem>
                        {selected.type === "PRESCRIPTION" && (
                          <DropdownMenuItem
                            onSelect={() => {
                              if (!readonly && data.context?.prescriptionPrintData) {
                                const defaults = data.context.prescriptionPrintData;
                                update({
                                  prescriptionPrintData: {
                                    ...emptyPrintData,
                                    ...buffer.prescriptionPrintData,
                                    patientDocument: defaults.patientDocument,
                                    patientAddress: defaults.patientAddress,
                                    patientAge: defaults.patientAge,
                                    issuerAddress: defaults.issuerAddress,
                                    issuerCity: defaults.issuerCity,
                                    issuerState: defaults.issuerState,
                                    issuerPhone: defaults.issuerPhone,
                                  },
                                });
                              }
                              setPrintDataOpen(true);
                            }}
                          >
                            Dados da receita
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          disabled={readonly || pending || !buffer.content.trim()}
                          onSelect={() => setTemplateForm(true)}
                        >
                          Salvar como modelo
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                {selected.type === "PRESCRIPTION" && (
                  <label className="mx-4 mb-2 flex w-fit items-center gap-2 text-sm sm:mx-6">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[#007aff]"
                      checked={buffer.twoCopies}
                      disabled={
                        readonly ||
                        pending ||
                        Boolean(
                          buffer.prescriptionPrintData &&
                          buffer.prescriptionPrintData.kind !== "SIMPLE",
                        )
                      }
                      onChange={(event) => update({ twoCopies: event.target.checked })}
                    />
                    <span>
                      Emitir receita em duas vias{" "}
                      <span className="text-xs text-[#636366]">
                        {buffer.prescriptionPrintData &&
                        buffer.prescriptionPrintData.kind !== "SIMPLE"
                          ? "(obrigatório neste receituário)"
                          : "(ex.: antibioticoterapia)"}
                      </span>
                    </span>
                  </label>
                )}
                {selected.type === "PRESCRIPTION" && !readonly && (
                  <div className="px-4 pb-3 sm:px-6">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={pending}
                      onClick={() => setComposerOpen(true)}
                    >
                      Compor receita estruturada
                    </Button>
                  </div>
                )}
                <div className="clinical-document-editor-slot px-3 pb-2 sm:px-5">
                  <ClinicalDocumentEditor
                    key={selected.id}
                    documentId={selected.id}
                    content={buffer.content}
                    richContent={buffer.richContent}
                    readonly={readonly}
                    disabled={pending}
                    title={
                      buffer.prescriptionPrintData?.kind === "SPECIAL_CONTROL"
                        ? "RECEITA DE CONTROLE ESPECIAL"
                        : selected.title || documentTitles[selected.type]
                    }
                    prescription={selected.type === "PRESCRIPTION"}
                    focusOnMount={focusId === selected.id}
                    onReady={onEditorReady}
                    onChange={(content, richContent) => update({ content, richContent })}
                  />
                </div>
                <div className="clinical-document-footer clinical-document-glass flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2 sm:px-5">
                  <div className="text-xs text-[#636366]" aria-live="polite">
                    <p>
                      {pending
                        ? "Salvando…"
                        : error
                          ? "Não foi possível salvar"
                          : selected.status === "FINAL"
                            ? "Documento finalizado · conteúdo imutável"
                            : buffer.dirty
                              ? "Alterações não salvas"
                              : "Rascunho salvo"}
                    </p>
                    <p className="mt-1">
                      {selected.authorName}
                      {selected.councilNumber
                        ? ` · ${selected.professionalCouncil} ${selected.councilNumber}/${selected.councilRegion}`
                        : ""}{" "}
                      · Versão {buffer.version}
                    </p>
                    {selected.status === "FINAL" && (
                      <details className="mt-1 max-w-sm">
                        <summary className="cursor-pointer">
                          {selected.integrityVerified
                            ? "Integridade verificada · SHA-256"
                            : selected.integrityVerified === false
                              ? "Falha na verificação de integridade"
                              : "Documento legado · integridade não verificada"}
                        </summary>
                        {selected.verificationCode && (
                          <p className="mt-1 break-all">
                            Código de verificação: {selected.verificationCode}
                          </p>
                        )}
                        <p className="mt-1 break-all">
                          {selected.contentSha256 ?? "Sem marca de integridade disponível."}
                        </p>
                        {selected.integrityRecordedAt && (
                          <p>
                            Marca registrada em{" "}
                            {new Date(selected.integrityRecordedAt).toLocaleString("pt-BR", {
                              timeZone: "America/Fortaleza",
                            })}
                            .
                          </p>
                        )}
                        <p>A marca de integridade não equivale a uma assinatura digital.</p>
                      </details>
                    )}
                    <p className="mt-1">
                      Finalização não equivale a assinatura eletrônica certificada.
                    </p>
                  </div>
                  {selected.canAmend && (
                    <Button
                      variant="outline"
                      className={buttonStyle}
                      disabled={pending}
                      onClick={() => {
                        setAmendmentKind("ADDENDUM");
                        setAmendmentReason("");
                      }}
                    >
                      Adendo ou retificação
                    </Button>
                  )}
                  {selected.status === "FINAL" && (
                    <DocumentSignatureActions key={selected.id} documentId={selected.id} />
                  )}
                  {!readonly && (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        className={buttonStyle}
                        disabled={pending || !buffer.content.trim()}
                        onClick={() => setTemplateForm(true)}
                      >
                        Salvar como modelo
                      </Button>
                      <Button
                        variant="outline"
                        className={buttonStyle}
                        disabled={pending || !buffer.dirty}
                        onClick={() => void save("SAVE_DRAFT")}
                      >
                        Salvar rascunho
                      </Button>
                      <Button
                        className="rounded-lg bg-teal-700 text-white hover:bg-teal-800"
                        disabled={pending || !buffer.content.trim()}
                        onClick={() => void save("FINALIZE")}
                      >
                        Finalizar documento
                      </Button>
                    </div>
                  )}
                </div>
                {selected.canEdit === false && selected.status === "DRAFT" && (
                  <p className="bg-white px-5 py-3 text-xs text-[#636366]">
                    Este rascunho pertence a {selected.authorName}. Somente seu autor pode
                    alterá-lo.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
        {workspace && contextOpen && (
          <aside
            className="encounter-document-context"
            aria-label={
              mode === "prescription" ? "Prévia da prescrição" : "Modelos de solicitações"
            }
          >
            {mode === "prescription" ? (
              <>
                <h3 className="mb-3 text-sm font-semibold">
                  {prescriptionCategory === "instructions"
                    ? "Prévia das orientações"
                    : "Prévia da prescrição"}
                </h3>
                {prescriptionCategory === "medications" && medications && (
                  <p className="mb-3 rounded-lg bg-teal-50 p-2 text-[11px] leading-5 text-teal-900">
                    O registro terapêutico possui salvamento próprio. Use Inserir itens na receita
                    para acrescentá-los a este documento.
                  </p>
                )}
                <div className="encounter-document-paper">
                  <h4 className="text-center text-sm font-semibold uppercase">
                    {selected?.status === "FINAL"
                      ? selected.finalPreview?.title || selected.title
                      : selected?.title || "Receita médica"}
                  </h4>
                  {data.context && (
                    <p className="mt-2 text-center text-[10px] text-muted-foreground">
                      {selected?.status === "FINAL"
                        ? selected.finalPreview?.patientName ||
                          "Identificação legada: consulte a impressão"
                        : data.context.patientName}
                    </p>
                  )}
                  <div className="my-5 min-h-48 whitespace-pre-wrap break-words text-xs leading-6">
                    {(selected?.status === "FINAL"
                      ? (selected.finalPreview?.content ?? selected.content)
                      : buffer?.content) ||
                      "O conteúdo da receita aparecerá aqui durante a edição."}
                  </div>
                  {selected && (
                    <div className="mt-8 border-t pt-3 text-center text-[10px] text-muted-foreground">
                      {selected.authorName}
                      {selected.councilNumber ? (
                        <p>
                          {selected.professionalCouncil} {selected.councilNumber}/
                          {selected.councilRegion}
                        </p>
                      ) : null}
                    </div>
                  )}
                </div>
                {buffer?.prescriptionSource && (
                  <p className="mt-3 text-[11px] leading-5 text-muted-foreground">
                    Origem: registro terapêutico, versão {buffer.prescriptionSource.version}. A
                    receita é um documento independente e exige revisão do prescritor.
                  </p>
                )}
                <p className="mt-3 text-[11px] leading-5 text-muted-foreground">
                  {selected?.status === "FINAL"
                    ? selected.artifactPreserved
                      ? "Documento finalizado com apresentação arquivada. Use Visualizar impressão para abrir o original."
                      : "Documento legado: conteúdo preservado no registro; a impressão é regenerada pelo renderizador atual."
                    : "Prévia de rascunho. Revise o conteúdo e os dados de impressão antes de finalizar."}
                </p>
              </>
            ) : (
              <>
                <h3 className="mb-3 text-sm font-semibold">Modelos de solicitações</h3>
                {workspaceTemplates.length ? (
                  <div className="space-y-1">
                    {workspaceTemplates.map((template) => (
                      <div
                        key={template.id}
                        className="flex items-center gap-2 border-b py-3 text-xs"
                      >
                        <FileText size={15} className="shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 break-words">{template.title}</span>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs text-teal-700"
                          disabled={pending || readonly || selected?.type !== template.type}
                          onClick={() =>
                            buffer?.content.trim() ? setApplying(template) : apply(template, true)
                          }
                        >
                          Usar
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-lg bg-muted/40 p-3 text-xs leading-5 text-muted-foreground">
                    Nenhum modelo disponível nesta categoria. Salve um documento revisado como
                    modelo para reutilizá-lo.
                  </p>
                )}
                <p className="mt-4 text-[11px] leading-5 text-muted-foreground">
                  Selecione um rascunho do mesmo tipo para aplicar um modelo. O conteúdo atual só
                  será substituído após sua confirmação.
                </p>
              </>
            )}
          </aside>
        )}
      </div>
      <Dialog
        open={composerOpen}
        onOpenChange={(open) => {
          if (
            !open &&
            (composerState.pending ||
              (composerState.dirty &&
                !window.confirm("Descartar a composição ainda não inserida na receita?")))
          )
            return;
          setComposerOpen(open);
          if (!open) setComposerState({ dirty: false, pending: false });
        }}
      >
        <DialogContent
          className="max-h-[94dvh] min-w-0 grid-cols-[minmax(0,1fr)] overflow-y-auto rounded-2xl"
          style={{ width: "min(96vw, 1600px)", maxWidth: "96vw", minWidth: 0 }}
        >
          <DialogHeader>
            <DialogTitle>Composição estruturada e protocolos pessoais</DialogTitle>
            <DialogDescription>
              Prepare e confira a composição antes de inseri-la na receita. A responsabilidade
              clínica permanece com o prescritor.
            </DialogDescription>
          </DialogHeader>
          {composerOpen && selected?.type === "PRESCRIPTION" && !readonly && (
            <PrescriptionComposer
              key={`${appointmentId}:${selected.id}`}
              appointmentId={appointmentId}
              documentId={selected.id}
              onDraftStateChange={setComposerState}
              onInsert={(text) => {
                if (!editorRef.current || readonly || pending) return false;
                editorRef.current
                  .chain()
                  .focus()
                  .insertContentAt(
                    editorRef.current.state.doc.content.size,
                    plainTextRichContent(text).content ?? [],
                  )
                  .run();
                setComposerOpen(false);
                setComposerState({ dirty: false, pending: false });
                if (mode === "prescription") {
                  setPrescriptionCategory("medications");
                  setShowRecipeEditor(true);
                }
                setMessage("Composição inserida. Revise o texto e salve o rascunho.");
                return true;
              }}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={amendmentKind !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setAmendmentKind(null);
        }}
      >
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>Adendo ou retificação</DialogTitle>
            <DialogDescription>
              Um novo rascunho será vinculado ao original. O conteúdo e a autoria do documento
              finalizado serão preservados.
            </DialogDescription>
          </DialogHeader>
          <label className="text-sm">
            Tipo
            <select
              className="mt-1 w-full rounded-xl border bg-white p-2"
              aria-label="Tipo do adendo ou retificação"
              value={amendmentKind ?? "ADDENDUM"}
              disabled={pending}
              onChange={(event) =>
                setAmendmentKind(event.target.value as "ADDENDUM" | "RECTIFICATION")
              }
            >
              <option value="ADDENDUM">Adendo — acrescentar informações</option>
              <option value="RECTIFICATION">Retificação — registrar uma correção</option>
            </select>
          </label>
          <label className="text-sm">
            Motivo obrigatório
            <textarea
              className="mt-1 min-h-24 w-full rounded-xl border bg-white p-2"
              minLength={5}
              maxLength={2000}
              disabled={pending}
              value={amendmentReason}
              onChange={(event) => setAmendmentReason(event.target.value)}
            />
          </label>
          <Button
            disabled={pending || amendmentReason.trim().length < 5}
            onClick={() => void createAmendment()}
          >
            {pending ? "Criando…" : "Criar rascunho vinculado"}
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog open={deliveryOpen} onOpenChange={setDeliveryOpen}>
        <DialogContent className="clinical-workspace max-h-[90dvh] overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle>Enviar receita ao paciente</DialogTitle>
            <DialogDescription>
              Confirme o contato e a situação da assinatura antes de compartilhar o documento.
            </DialogDescription>
          </DialogHeader>
          {deliveryOpen && selected && (
            <DocumentDelivery key={selected.id} documentId={selected.id} />
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={verificationOpen} onOpenChange={setVerificationOpen}>
        <DialogContent className="clinical-workspace max-h-[90dvh] overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle>Verificar documento</DialogTitle>
            <DialogDescription>
              Verificação interna de um documento finalizado, mediante acesso autorizado.
            </DialogDescription>
          </DialogHeader>
          <ClinicalDocumentVerification
            key={verificationOpen ? (selected?.id ?? "empty") : "closed"}
            initialCode={selected?.verificationCode ?? ""}
          />
        </DialogContent>
      </Dialog>
      <Dialog open={printDataOpen} onOpenChange={setPrintDataOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle>Dados da receita</DialogTitle>
            <DialogDescription>
              Confira os dados para impressão. Duas vias não substituem os requisitos específicos de
              cada receituário.
            </DialogDescription>
          </DialogHeader>
          <label className="space-y-1 text-sm">
            Tipo de receituário
            <select
              className="h-10 w-full rounded-xl border bg-white px-3"
              disabled={readonly || pending}
              value={buffer?.prescriptionPrintData?.kind ?? "SIMPLE"}
              onChange={(event) => {
                const kind = event.target.value as PrescriptionPrintData["kind"];
                update({
                  prescriptionPrintData: {
                    ...emptyPrintData,
                    ...buffer?.prescriptionPrintData,
                    kind,
                  },
                  ...(kind !== "SIMPLE" ? { twoCopies: true } : {}),
                });
              }}
            >
              <option value="SIMPLE">Receita simples</option>
              <option value="ANTIMICROBIAL">Antimicrobianos</option>
              <option value="SPECIAL_CONTROL">Receita de controle especial</option>
            </select>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ["patientDocument", "Documento do paciente"],
                ["patientAddress", "Endereço do paciente"],
                ["patientAge", "Idade do paciente"],
                ["patientSex", "Sexo do paciente"],
                ["issuerAddress", "Endereço profissional"],
                ["issuerPhone", "Telefone profissional"],
                ["issuerCity", "Cidade de emissão"],
                ["issuerState", "UF de emissão"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="space-y-1 text-sm">
                {label}
                <Input
                  disabled={readonly || pending}
                  readOnly={key !== "patientSex"}
                  type={key === "patientAge" ? "number" : "text"}
                  min={key === "patientAge" ? 0 : undefined}
                  max={key === "patientAge" ? 130 : undefined}
                  value={buffer?.prescriptionPrintData?.[key] ?? ""}
                  maxLength={key === "issuerState" ? 2 : 500}
                  onChange={(event) =>
                    update({
                      prescriptionPrintData: {
                        ...emptyPrintData,
                        ...buffer?.prescriptionPrintData,
                        [key]:
                          key === "patientAge"
                            ? event.target.value === ""
                              ? null
                              : Number(event.target.value)
                            : event.target.value,
                      },
                    })
                  }
                />
              </label>
            ))}
          </div>
          <p className="text-xs text-[#636366]">
            Documento, endereço e idade do paciente vêm do cadastro. Corrija-os no cadastro e
            recarregue o atendimento. Endereço, cidade, UF e telefone do emissor vêm do cadastro
            profissional e só podem ser corrigidos por um administrador em Administração → Usuários.
            As alterações são salvas com o rascunho; dados ausentes não são inventados.
          </p>
          <Button onClick={() => setPrintDataOpen(false)}>Concluir</Button>
        </DialogContent>
      </Dialog>
      <Dialog open={templateForm} onOpenChange={setTemplateForm}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>Salvar como modelo</DialogTitle>
            <DialogDescription>
              Modelos são pessoais e reutilizáveis. Remova dados que identifiquem o paciente antes
              de salvar.
            </DialogDescription>
          </DialogHeader>
          <label className="space-y-2 text-sm">
            Nome do modelo
            <Input
              value={templateName}
              maxLength={160}
              disabled={pending}
              onChange={(event) => setTemplateName(event.target.value)}
            />
          </label>
          <Button
            disabled={pending || !templateName.trim()}
            onClick={() => void save("SAVE_TEMPLATE")}
          >
            Salvar modelo
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(applying)}
        onOpenChange={(open) => {
          if (!open) setApplying(null);
        }}
      >
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>Aplicar modelo</DialogTitle>
            <DialogDescription>
              O documento já contém texto. Escolha como aplicar “{applying?.title}”.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => applying && apply(applying, false)}>Inserir no cursor</Button>
            <Button variant="outline" onClick={() => applying && apply(applying, true)}>
              Substituir conteúdo
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-h-[80vh] overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle>Histórico de documentos</DialogTitle>
            <DialogDescription>
              Documentos deste atendimento, autoria e versão atual. Versões anteriores não estão
              disponíveis nesta tela.
            </DialogDescription>
          </DialogHeader>
          {data.documents.map((item) => (
            <button
              key={item.id}
              type="button"
              className="rounded-xl border p-3 text-left text-sm"
              onClick={() => {
                select(item.id);
                setHistoryOpen(false);
              }}
            >
              <span className="block font-medium">
                {item.amendment
                  ? item.amendment.kind === "ADDENDUM"
                    ? "Adendo"
                    : "Retificação"
                  : labels[item.type]}{" "}
                · {item.status === "FINAL" ? "Finalizado" : "Rascunho"}
              </span>
              <span className="text-xs text-[#636366]">
                {item.authorName} · Versão {item.version}
              </span>
            </button>
          ))}
        </DialogContent>
      </Dialog>
    </section>
  );
}
