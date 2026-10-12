import { FileText, Plus, Printer } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { readInventoryResponse, useInventory } from "@/data/inventory-api";
import { InventoryState } from "./inventory-state";

type DocumentType = "PRESCRIPTION" | "EXAM_REQUEST";
type ClinicalDocument = {
  id: string;
  type: DocumentType;
  title: string;
  content: string;
  status: "DRAFT" | "FINAL";
  version: number;
  authorName: string;
  professionalCouncil: string;
  councilNumber: string;
  councilRegion: string;
  canEdit?: boolean;
};
type Template = { id: string; type: DocumentType; title: string; content: string };
type Payload = { documents: ClinicalDocument[]; templates: Template[]; canAuthor: boolean };
const labels: Record<DocumentType, string> = {
  PRESCRIPTION: "Prescrição",
  EXAM_REQUEST: "Solicitação de exames",
};

export function EncounterDocumentsCard({ appointmentId }: { appointmentId: string }) {
  const query = useInventory<Payload>(
    `encounter-documents?appointmentId=${encodeURIComponent(appointmentId)}`,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [type, setType] = useState<DocumentType>("PRESCRIPTION");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [version, setVersion] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [showTemplateForm, setShowTemplateForm] = useState(false);
  const selected = query.data?.documents.find((document) => document.id === selectedId);
  const readonly =
    !query.data?.canAuthor || selected?.status === "FINAL" || selected?.canEdit === false;

  useEffect(() => {
    setSelectedId(null);
    setTitle("");
    setContent("");
    setVersion(null);
    setDirty(false);
    setMessage("");
    setError("");
  }, [appointmentId]);

  function select(document: ClinicalDocument | null, nextType: DocumentType = "PRESCRIPTION") {
    if (
      pending ||
      (dirty && !window.confirm("Descartar as alterações ainda não salvas deste documento?"))
    )
      return;
    setSelectedId(document?.id ?? null);
    setType(document?.type ?? nextType);
    setTitle(document?.title ?? labels[nextType]);
    setContent(document?.content ?? "");
    setVersion(document?.version ?? null);
    setDirty(false);
    setTemplateId("");
    setShowTemplateForm(false);
    setMessage("");
    setError("");
  }

  async function save(action: "SAVE_DRAFT" | "FINALIZE" | "SAVE_TEMPLATE") {
    if (submitting.current || readonly) return;
    if (!title.trim() || !content.trim()) {
      setError("Preencha o título e o conteúdo do documento.");
      return;
    }
    if (action === "SAVE_TEMPLATE" && !templateName.trim()) {
      setError("Informe um nome para o modelo.");
      return;
    }
    if (
      action === "SAVE_TEMPLATE" &&
      !window.confirm(
        "Confira e remova nomes, documentos e demais dados pessoais do paciente antes de salvar este conteúdo como modelo reutilizável. Continuar?",
      )
    )
      return;
    if (
      action === "FINALIZE" &&
      !window.confirm(
        "Finalizar este documento? O conteúdo ficará imutável. Confira a prescrição ou a solicitação antes de continuar.",
      )
    )
      return;
    submitting.current = true;
    setPending(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/v1/inventory/encounter-documents", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          appointmentId,
          documentId: selectedId,
          type,
          title: action === "SAVE_TEMPLATE" ? templateName.trim() : title.trim(),
          content,
          version,
        }),
      });
      const result = await readInventoryResponse<{ id: string; version: number }>(
        response,
        "Não foi possível salvar o documento.",
      );
      const refreshed = await query.refetch();
      if (action !== "SAVE_TEMPLATE") {
        const saved = refreshed.data?.documents.find((document) => document.id === result.data?.id);
        if (saved) {
          setSelectedId(saved.id);
          setVersion(saved.version);
          setTitle(saved.title);
          setContent(saved.content);
        }
        setDirty(false);
      } else {
        setShowTemplateForm(false);
        setTemplateName("");
      }
      setMessage(
        action === "FINALIZE"
          ? "Documento finalizado."
          : action === "SAVE_TEMPLATE"
            ? "Modelo salvo para seus próximos atendimentos."
            : "Rascunho salvo.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Não foi possível conectar. Tente novamente.",
      );
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  if (query.isPending || query.error)
    return (
      <InventoryState pending={query.isPending} error={query.error} retry={() => query.refetch()} />
    );
  const data = query.data!;
  const templates = data.templates.filter((template) => template.type === type);

  return (
    <section
      className="overflow-hidden rounded-xl border bg-white"
      aria-label="Documentos do atendimento"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
        <div>
          <h2 className="font-semibold">Prescrições e solicitações de exames</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Cada documento tem seu próprio rascunho e versão final. Injetáveis e orçamento
            permanecem na seção de tratamento.
          </p>
        </div>
        <Badge variant="outline">
          {selected?.status === "FINAL"
            ? "Finalizado"
            : dirty
              ? "Alterações não salvas"
              : "Rascunho"}
        </Badge>
      </div>
      <div className="grid md:grid-cols-[190px_minmax(0,1fr)]">
        <aside
          className="space-y-3 border-b bg-muted/10 p-3 md:border-b-0 md:border-r"
          aria-label="Lista de documentos"
        >
          <p className="px-2 text-xs font-medium text-muted-foreground">
            Documentos deste atendimento
          </p>
          {data.documents.length ? (
            <div className="flex gap-2 overflow-x-auto md:block md:space-y-1">
              {data.documents.map((document, index) => (
                <button
                  key={document.id}
                  type="button"
                  disabled={pending}
                  aria-pressed={selectedId === document.id}
                  onClick={() => select(document)}
                  className={`min-w-[150px] rounded-lg border px-3 py-2 text-left text-sm md:w-full ${selectedId === document.id ? "border-primary/30 bg-primary/5" : "border-transparent hover:bg-muted/50"}`}
                >
                  <span className="flex items-center gap-2">
                    <FileText className="h-4 w-4 shrink-0" />
                    Documento {index + 1}
                  </span>
                  <span className="mt-1 block break-words text-xs">{document.title}</span>
                  <span className="mt-1 block text-[11px] text-muted-foreground">
                    {document.status === "FINAL" ? "Finalizado" : "Rascunho"}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="px-2 text-xs text-muted-foreground">Nenhum documento salvo.</p>
          )}
          {data.canAuthor && (
            <div className="flex flex-wrap gap-2 md:flex-col">
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => select(null, "PRESCRIPTION")}
              >
                <Plus className="h-4 w-4" />
                Nova prescrição
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => select(null, "EXAM_REQUEST")}
              >
                <Plus className="h-4 w-4" />
                Solicitar exames
              </Button>
            </div>
          )}
        </aside>
        <div className="min-w-0 space-y-4 p-5">
          {(message || error) && (
            <p
              role={error ? "alert" : "status"}
              className={`rounded-lg border p-3 text-sm ${error ? "border-destructive/30 text-destructive" : ""}`}
            >
              {error || message}
            </p>
          )}
          {!data.canAuthor && !selected ? (
            <p className="py-6 text-sm text-muted-foreground">
              Selecione um documento para consultar. A elaboração exige o profissional responsável
              pelo atendimento.
            </p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px]">
                <label className="space-y-1 text-sm font-medium">
                  Título do documento
                  <Input
                    value={title}
                    disabled={readonly || pending}
                    maxLength={160}
                    placeholder={labels[type]}
                    onChange={(event) => {
                      setTitle(event.target.value);
                      setDirty(true);
                    }}
                  />
                </label>
                <label className="space-y-1 text-sm font-medium">
                  Tipo
                  <select
                    className="h-10 w-full rounded-md border bg-white px-3 text-sm"
                    value={type}
                    disabled={readonly || pending || Boolean(selectedId)}
                    onChange={(event) => {
                      setType(event.target.value as DocumentType);
                      setTemplateId("");
                      setDirty(true);
                    }}
                  >
                    <option value="PRESCRIPTION">Prescrição</option>
                    <option value="EXAM_REQUEST">Solicitação de exames</option>
                  </select>
                </label>
              </div>
              {!readonly && (
                <div className="flex flex-wrap items-end gap-2">
                  <label className="min-w-0 flex-1 space-y-1 text-sm">
                    Modelo opcional
                    <select
                      className="h-10 w-full rounded-md border bg-white px-3 text-sm"
                      value={templateId}
                      disabled={pending}
                      onChange={(event) => setTemplateId(event.target.value)}
                    >
                      <option value="">
                        {templates.length
                          ? "Escolha um modelo"
                          : "Nenhum modelo salvo para este tipo"}
                      </option>
                      {templates.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Button
                    variant="outline"
                    disabled={!templateId || pending}
                    onClick={() => {
                      const template = templates.find((item) => item.id === templateId);
                      if (
                        !template ||
                        (content.trim() &&
                          !window.confirm("Substituir o conteúdo atual pelo modelo selecionado?"))
                      )
                        return;
                      setTitle(template.title);
                      setContent(template.content);
                      setDirty(true);
                    }}
                  >
                    Aplicar modelo
                  </Button>
                </div>
              )}
              <label className="block space-y-2 text-sm font-medium">
                {labels[type]}
                <Textarea
                  className="min-h-[420px] resize-y border-muted bg-white text-base font-normal leading-7"
                  value={content}
                  maxLength={30000}
                  disabled={readonly || pending}
                  placeholder={
                    type === "PRESCRIPTION"
                      ? "Medicamento ou fórmula, apresentação, dose, via, frequência, duração e orientações…"
                      : "Exames solicitados e orientações para realização…"
                  }
                  onChange={(event) => {
                    setContent(event.target.value);
                    setDirty(true);
                  }}
                />
              </label>
              {selected && (
                <p className="text-xs text-muted-foreground">
                  Autoria: {selected.authorName}
                  {selected.councilNumber
                    ? ` · ${selected.professionalCouncil} ${selected.councilNumber}/${selected.councilRegion}`
                    : ""}{" "}
                  · Versão {selected.version}
                </p>
              )}
              {selected?.status === "DRAFT" && selected.canEdit === false && (
                <p className="text-xs text-muted-foreground">
                  Este rascunho pertence a {selected.authorName}. Somente seu autor pode alterá-lo.
                  Crie um novo documento para registrar sua prescrição ou solicitação.
                </p>
              )}
              {selected?.status === "FINAL" ? (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Documento finalizado. A impressão não inclui assinatura eletrônica certificada.
                  </p>
                  <Button variant="outline" asChild>
                    <a
                      href={`/api/v1/inventory/encounter-documents?documentId=${encodeURIComponent(selected.id)}&print=true`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Printer className="h-4 w-4" />
                      Imprimir / salvar PDF
                    </a>
                  </Button>
                </div>
              ) : (
                !readonly && (
                  <>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        disabled={pending || !content.trim()}
                        onClick={() => save("SAVE_DRAFT")}
                      >
                        {pending ? "Salvando…" : "Salvar rascunho"}
                      </Button>
                      <Button
                        variant="outline"
                        disabled={pending || !content.trim()}
                        onClick={() => save("FINALIZE")}
                      >
                        Finalizar documento
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={pending || !content.trim()}
                        onClick={() => setShowTemplateForm(!showTemplateForm)}
                      >
                        Salvar como modelo
                      </Button>
                    </div>
                    {showTemplateForm && (
                      <div className="flex flex-wrap items-end gap-2 rounded-lg border p-3">
                        <p className="w-full text-xs text-muted-foreground">
                          Modelos são pessoais e reutilizáveis. Remova dados que identifiquem o
                          paciente antes de salvar.
                        </p>
                        <label className="min-w-[180px] flex-1 space-y-1 text-sm">
                          Nome do modelo
                          <Input
                            value={templateName}
                            maxLength={160}
                            disabled={pending}
                            onChange={(event) => setTemplateName(event.target.value)}
                          />
                        </label>
                        <Button
                          variant="outline"
                          disabled={pending || !templateName.trim()}
                          onClick={() => save("SAVE_TEMPLATE")}
                        >
                          Salvar modelo
                        </Button>
                      </div>
                    )}
                  </>
                )
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
