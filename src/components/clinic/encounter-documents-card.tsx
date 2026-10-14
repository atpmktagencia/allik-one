import {
  FileText,
  Plus,
  Printer,
  ChevronDown,
  History,
  MoreHorizontal,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
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
    prescriptionPrintData?: PrescriptionPrintData;
  };
};
type Buffer = {
  content: string;
  richContent: RichContentNode | null;
  twoCopies: boolean;
  prescriptionPrintData: PrescriptionPrintData | null;
  dirty: boolean;
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
function initialBuffer(document: ClinicalDocument): Buffer {
  return {
    content: document.content,
    richContent: document.richContent ?? null,
    twoCopies: document.twoCopies ?? false,
    prescriptionPrintData: document.prescriptionPrintData ?? null,
    dirty: false,
    version: document.version,
  };
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

export function EncounterDocumentsCard({ appointmentId }: { appointmentId: string }) {
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
  const [historyOpen, setHistoryOpen] = useState(false);
  const [printDataOpen, setPrintDataOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
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
  const editorRef = useRef<Editor | null>(null);
  const onEditorReady = useCallback((editor: Editor | null) => {
    editorRef.current = editor;
  }, []);
  const allowedTypes = query.data?.allowedDocumentTypes ?? documentTypes;
  const selected = query.data?.documents.find((item) => item.id === selectedId);
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
    !query.data?.canAuthor || selected?.status === "FINAL" || selected?.canEdit === false;
  useEffect(() => {
    setSelectedId(null);
    setBuffers({});
    setMessage("");
    setError("");
    setFocusId(null);
  }, [appointmentId]);
  useEffect(() => {
    if (!selectedId && query.data?.documents[0]) {
      const callbackId = new URL(window.location.href).searchParams.get("signatureDocumentId");
      setSelectedId(
        query.data.documents.find((item) => item.id === callbackId)?.id ??
          query.data.documents[0].id,
      );
    }
  }, [query.data, selectedId]);
  useEffect(() => {
    const dirty = Object.values(buffers).some((item) => item.dirty);
    if (!dirty) return;
    const prevent = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [buffers]);
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
    if (submitting.current || !query.data?.canAuthor || !allowedTypes.includes(type)) return;
    submitting.current = true;
    setPending(true);
    setError("");
    setMessage("");
    try {
      const result = await request({
        action: "SAVE_DRAFT",
        documentId: null,
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
      setFocusId(result.data.id);
      setMessage("Rascunho criado.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível criar o documento.");
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }
  async function save(action: "SAVE_DRAFT" | "FINALIZE" | "SAVE_TEMPLATE"): Promise<boolean> {
    if (submitting.current || readonly || !selected || !buffer) return false;
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
      setError(
        cause instanceof Error ? cause.message : "Não foi possível salvar. Tente novamente.",
      );
      return false;
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }
  async function print() {
    if (!selected || pending) return;
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
  const counts: Partial<Record<DocumentType, number>> = {};
  return (
    <section
      className={`clinical-documents${expanded ? " clinical-documents-expanded" : ""}`}
      aria-label="Documentos do atendimento"
    >
      {data.context && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-white px-5 py-3 text-sm">
          <p className="font-semibold">
            Allik One <span className="font-normal text-[#636366]">· {data.context.unitName}</span>
          </p>
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            <span>
              {data.context.patientName}
              {age !== null ? ` · ${age} anos` : ""}
            </span>
            <span className="text-[#636366]">
              Alergias:{" "}
              {data.context.allergies === null || data.context.allergies === undefined
                ? "não informadas"
                : data.context.allergies.length
                  ? data.context.allergies.join(", ")
                  : "nega alergias"}
            </span>
          </div>
        </div>
      )}
      <div className="bg-white px-4 pb-1 pt-3 sm:px-5">
        <h2 className="mb-2 text-lg font-semibold tracking-tight">Documentos deste atendimento</h2>
        <div className="flex min-w-0 flex-wrap items-start gap-2">
          <div
            className="clinical-document-tabs min-w-0 flex-1"
            role="tablist"
            aria-label="Documentos deste atendimento"
          >
            {data.documents.map((item) => {
              counts[item.type] = (counts[item.type] ?? 0) + 1;
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
                  onClick={() => select(item.id)}
                  onKeyDown={(event) => {
                    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
                    event.preventDefault();
                    const index = data.documents.findIndex((document) => document.id === item.id);
                    const nextIndex =
                      event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? data.documents.length - 1
                          : (index +
                              (event.key === "ArrowRight" ? 1 : -1) +
                              data.documents.length) %
                            data.documents.length;
                    select(data.documents[nextIndex]!.id);
                    document
                      .getElementById(`document-tab-${data.documents[nextIndex]!.id}`)
                      ?.focus();
                  }}
                >
                  <span className="text-sm font-medium">
                    {tabLabels[item.type]} {counts[item.type]}
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
          {data.canAuthor && allowedTypes.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className={`${buttonStyle} text-[#007aff]`}
                  disabled={pending}
                >
                  <Plus size={16} />
                  Novo documento
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className={menuStyle}>
                {allowedTypes.map((type) => (
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
      {!selected || !buffer ? (
        <div className="px-6 py-12 text-sm text-[#636366]">
          {data.canAuthor && allowedTypes.length > 0
            ? "Escolha um tipo de documento autorizado para iniciar."
            : "Nenhum documento disponível. A elaboração exige o profissional responsável pelo atendimento."}
        </div>
      ) : (
        <div
          id={`document-panel-${selected.id}`}
          role="tabpanel"
          className="clinical-document-panel"
          aria-labelledby={`document-tab-${selected.id}`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 sm:px-5">
            <div className="flex flex-wrap gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className={buttonStyle} disabled={readonly || pending}>
                    Modelos
                    <ChevronDown size={15} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className={`${menuStyle} max-w-[300px]`}>
                  {templates.length ? (
                    templates.map((template) => (
                      <DropdownMenuItem
                        key={template.id}
                        onSelect={() =>
                          buffer.content.trim() ? setApplying(template) : apply(template, true)
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
              <Button
                variant="outline"
                className={buttonStyle}
                disabled={pending || (selected.status === "DRAFT" && readonly)}
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
                  {selected.type === "PRESCRIPTION" && (
                    <DropdownMenuItem onSelect={() => setPrintDataOpen(true)}>
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
                    buffer.prescriptionPrintData && buffer.prescriptionPrintData.kind !== "SIMPLE",
                  )
                }
                onChange={(event) => update({ twoCopies: event.target.checked })}
              />
              <span>
                Emitir receita em duas vias{" "}
                <span className="text-xs text-[#636366]">
                  {buffer.prescriptionPrintData && buffer.prescriptionPrintData.kind !== "SIMPLE"
                    ? "(obrigatório neste receituário)"
                    : "(ex.: antibioticoterapia)"}
                </span>
              </span>
            </label>
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
              <p className="mt-1">Finalização não equivale a assinatura eletrônica certificada.</p>
            </div>
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
                  className="rounded-xl bg-[#007aff] text-white hover:bg-[#0067d6]"
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
              Este rascunho pertence a {selected.authorName}. Somente seu autor pode alterá-lo.
            </p>
          )}
        </div>
      )}
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
            As alterações são salvas com o rascunho. Dados ausentes não são inventados.
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
                {labels[item.type]} · {item.status === "FINAL" ? "Finalizado" : "Rascunho"}
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
