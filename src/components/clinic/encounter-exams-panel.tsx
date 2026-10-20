import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  Download,
  ExternalLink,
  FileText,
  FlaskConical,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { selectedUnitId, withSelectedUnit } from "@/data/unit-context";
import { useInventory } from "@/data/inventory-api";
import type { LaboratoryHistoryEntry } from "@/lib/laboratory-history";
import { LaboratoryHistory } from "./laboratory-history";
import {
  PatientDocumentCenter,
  type PatientDocument,
  type PatientDocumentsPayload,
  type PatientDocumentCenterViewState,
} from "./patient-document-center";
import { InventoryState } from "./inventory-state";
import { LaboratoryReview } from "./laboratory-review";
import { PrivateDocumentPreview } from "./private-document-preview";
import "./clinical-exams-workspace.css";

type Props = {
  patientId: string;
  active?: boolean;
  unitId?: string | undefined;
  onNavigate?: (target: "exams" | "documents" | "questionnaires") => void;
};
type ExamSource = Pick<PatientDocument, "title" | "contentType" | "previewUrl"> & {
  documentId: string;
  canReview: boolean;
};
const processingLabels: Record<string, string> = {
  WAITING: "Aguardando processamento",
  PROCESSING: "Processando",
  READY_REVIEW: "Pronto para revisão",
  VALIDATED: "Validado",
  FAILED: "Falha no processamento",
};
function originalUrl(value: string | null, download = false, unitId?: string) {
  if (!value || !value.startsWith("/api/v1/inventory/") || value.startsWith("//")) return null;
  const url = new URL(value, "https://private.invalid");
  if (unitId !== undefined) url.searchParams.set("unitId", unitId);
  if (download) url.searchParams.set("download", "true");
  return withSelectedUnit(`${url.pathname}${url.search}`);
}
export function EncounterExamsPanel({ patientId, unitId, active = true }: Props) {
  const [filesOpen, setFilesOpen] = useState(false);
  const viewState = useRef<PatientDocumentCenterViewState | null>(null);
  const filesScroll = useRef(0);
  const filesDialog = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<{ scope: string; source: ExamSource } | null>(null);
  const scope = `${patientId}:${unitId ?? selectedUnitId()}`;
  const source = selected?.scope === scope ? selected.source : null;
  const url = source?.previewUrl ? originalUrl(source.previewUrl) : null;
  const download = source?.previewUrl ? originalUrl(source.previewUrl, true) : null;
  const files = useInventory<PatientDocumentsPayload>(
    `patient-documents?patientId=${encodeURIComponent(patientId)}&categoryGroup=EXAMS&limit=5` +
      (unitId !== undefined ? `&unitId=${encodeURIComponent(unitId)}` : ""),
    { enabled: active },
  );
  function canCloseFileEditor() {
    return window.dispatchEvent(
      new CustomEvent("allik:before-clinical-file-close", {
        cancelable: true,
        detail: { patientId },
      }),
    );
  }
  function selectSource(next: ExamSource) {
    if (source && source.documentId !== next.documentId && !canCloseFileEditor()) return;
    setSelected({
      scope,
      source: { ...next, previewUrl: originalUrl(next.previewUrl, false, unitId) ?? "" },
    });
  }
  function openOriginal(entry: LaboratoryHistoryEntry) {
    selectSource({
      documentId: entry.documentId,
      title: entry.documentTitle,
      previewUrl: entry.previewUrl,
      contentType: "application/pdf",
      canReview: files.data?.canUpload === true,
    });
  }
  useEffect(() => {
    const reset = () => {
      setSelected(null);
      setFilesOpen(false);
    };
    window.addEventListener("inventory-unit-change", reset);
    return () => window.removeEventListener("inventory-unit-change", reset);
  }, []);
  useEffect(() => {
    if (!filesOpen) return;
    const frame = requestAnimationFrame(() => {
      if (filesDialog.current) filesDialog.current.scrollTop = filesScroll.current;
    });
    return () => cancelAnimationFrame(frame);
  }, [filesOpen]);
  return (
    <section aria-label="Exames do atendimento" className="clinical-exams-workspace min-w-0">
      <header className="clinical-exams-heading">
        <div className="flex min-w-0 items-center gap-3">
          <span className="clinical-exams-emblem">
            <FlaskConical className="size-5" />
          </span>
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-slate-900">
              Exames laboratoriais
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Histórico confirmado e documentos de origem
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-9 text-xs"
            onClick={() => setFilesOpen(true)}
          >
            <FileText className="mr-1.5 size-3.5" />
            Conferir extrações
          </Button>
          <Button
            size="sm"
            className="h-9 text-xs"
            disabled={files.data?.canUpload === false}
            onClick={() => setFilesOpen(true)}
          >
            <Upload className="mr-1.5 size-3.5" />
            Importar exame (PDF)
          </Button>
        </div>
      </header>
      <div className={`clinical-exams-body ${source ? "clinical-exams-body--original" : ""}`}>
        <div className="min-w-0">
          <LaboratoryHistory
            key={scope}
            patientId={patientId}
            unitId={unitId}
            compact
            active={active}
            onOpenOriginal={openOriginal}
          />
        </div>
        {source && (
          <aside aria-label="Documento original do exame" className="clinical-exams-original">
            <header className="flex min-h-12 items-center justify-between gap-2 border-b p-3">
              <h3 className="flex items-center gap-2 text-xs font-semibold">
                <FileText className="size-4 text-primary" />
                Documento original
              </h3>
              <div className="flex items-center gap-1">
                {download && (
                  <a
                    href={download}
                    className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px]"
                  >
                    <Download className="size-3" />
                    Baixar
                  </a>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label="Fechar documento original"
                  onClick={() => {
                    if (canCloseFileEditor()) setSelected(null);
                  }}
                >
                  <X className="size-4" />
                </Button>
              </div>
            </header>
            <div className="space-y-3 p-3">
              <p className="break-words text-xs font-medium text-slate-700">{source.title}</p>
              {url ? (
                <>
                  {source.canReview && (
                    <LaboratoryReview
                      key={`${scope}:${source.documentId}:review`}
                      patientId={patientId}
                      documentId={source.documentId}
                      unitId={unitId}
                    />
                  )}
                  <PrivateDocumentPreview key={`${scope}:${source.documentId}`} document={source} />
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-center gap-2 rounded-lg border bg-slate-50 py-2 text-xs"
                  >
                    <ExternalLink className="size-3.5" />
                    Abrir original em nova janela
                  </a>
                </>
              ) : (
                <p role="alert" className="text-xs text-amber-900">
                  Não foi possível identificar uma origem privada válida para este arquivo.
                </p>
              )}
            </div>
          </aside>
        )}
      </div>
      <section aria-label="Arquivos de exames do paciente" className="clinical-exams-files">
        <details>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-3 text-xs font-medium">
            <span className="flex items-center gap-2">
              <FileText className="size-4 text-primary" />
              Arquivos de exames
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">
                {files.data?.total ?? "—"}
              </span>
            </span>
            <span className="flex items-center gap-2 text-muted-foreground">
              Recentes e pendências
              <ChevronDown className="size-3.5" />
            </span>
          </summary>
          <div className="border-t px-3.5 pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2 py-2">
              <p className="text-xs text-muted-foreground">
                Os valores só entram no histórico após conferência e confirmação.
              </p>
              <Button variant="ghost" size="sm" onClick={() => setFilesOpen(true)}>
                Ver todos os arquivos
              </Button>
            </div>
            {files.isPending || files.error ? (
              <InventoryState
                pending={files.isPending}
                error={files.error}
                retry={() => void files.refetch()}
              />
            ) : files.data?.documents.length ? (
              <ul className="divide-y divide-slate-100">
                {files.data.documents.map((file) => (
                  <li key={file.id}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 rounded-md px-1 py-2 text-left text-xs hover:bg-teal-50/60 focus-visible:outline-2 focus-visible:outline-teal-700"
                      aria-label={`Abrir exame: ${file.title}`}
                      aria-pressed={source?.documentId === file.sourceId}
                      onClick={() =>
                        selectSource({
                          documentId: file.sourceId,
                          title: file.title,
                          previewUrl: file.previewUrl,
                          contentType: file.contentType,
                          canReview:
                            files.data?.canUpload === true &&
                            file.sourceKind === "GENERAL_DOCUMENT" &&
                            file.contentType === "application/pdf",
                        })
                      }
                    >
                      <span className="min-w-0 break-words font-medium text-slate-700">
                        {file.title}
                      </span>
                      <span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-[11px] text-slate-600">
                        {file.laboratoryStatus
                          ? (processingLabels[file.laboratoryStatus] ??
                            "Processamento em acompanhamento")
                          : file.sourceKind === "GENERAL_DOCUMENT"
                            ? "Original disponível"
                            : "Solicitação de exames"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-2 text-xs text-muted-foreground">Nenhum arquivo de exame anexado.</p>
            )}
            {files.data?.hasMore && (
              <p className="mt-2 text-xs text-muted-foreground">
                Exibindo os {files.data.documents.length} arquivos mais recentes de{" "}
                {files.data.total}. Use “Ver todos os arquivos” para consultar os demais.
              </p>
            )}
          </div>
        </details>
      </section>
      <Dialog
        open={filesOpen}
        onOpenChange={(value) => {
          if (!value && !canCloseFileEditor()) return;
          setFilesOpen(value);
          if (!value) void files.refetch();
        }}
      >
        <DialogContent
          ref={filesDialog}
          onScroll={(event) => {
            filesScroll.current = event.currentTarget.scrollTop;
          }}
          className="clinical-workspace max-h-[92dvh] w-[calc(100%-1rem)] max-w-[1400px] overflow-y-auto"
        >
          <DialogHeader>
            <DialogTitle>Arquivos e conferência de exames</DialogTitle>
            <DialogDescription>
              Importe o original e confira os resultados antes de incluí-los no histórico clínico.
            </DialogDescription>
          </DialogHeader>
          <PatientDocumentCenter
            key={scope}
            patientId={patientId}
            unitId={unitId}
            active={filesOpen}
            viewState={viewState}
            examsOnly
          />
        </DialogContent>
      </Dialog>
    </section>
  );
}
