import { useEffect, useRef, useState } from "react";
import {
  Download,
  ExternalLink,
  FileText,
  PanelRightClose,
  PanelRightOpen,
  Upload,
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
function originalUrl(value: string, download = false) {
  if (!value.startsWith("/api/v1/inventory/") || value.startsWith("//")) return null;
  const url = new URL(value, "https://private.invalid");
  if (download) url.searchParams.set("download", "true");
  return withSelectedUnit(`${url.pathname}${url.search}`);
}
export function EncounterExamsPanel({ patientId, unitId, active = true }: Props) {
  const [filesOpen, setFilesOpen] = useState(false);
  const viewState = useRef<PatientDocumentCenterViewState | null>(null);
  const filesScroll = useRef(0);
  const filesDialog = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);
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
  function openOriginal(entry: LaboratoryHistoryEntry) {
    setSelected({
      scope,
      source: {
        documentId: entry.documentId,
        title: entry.documentTitle,
        previewUrl: entry.previewUrl,
        contentType: "application/pdf",
        canReview: files.data?.canUpload === true,
      },
    });
    setCollapsed(false);
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
    if (filesOpen) {
      const frame = requestAnimationFrame(() => {
        if (filesDialog.current) filesDialog.current.scrollTop = filesScroll.current;
      });
      return () => cancelAnimationFrame(frame);
    }
    return undefined;
  }, [filesOpen]);
  return (
    <section aria-label="Exames do atendimento" className="min-w-0">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-teal-50 text-teal-700">
            <FileText className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-slate-900">
              Exames laboratoriais
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Resultados validados, documentos e evolução
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-9 text-xs"
            onClick={() => {
              setFilesOpen(true);
            }}
          >
            Conferir extrações
          </Button>
          <Button
            size="sm"
            className="h-9 bg-teal-700 text-xs hover:bg-teal-800"
            onClick={() => {
              setFilesOpen(true);
            }}
          >
            <Upload className="mr-1.5 h-3.5 w-3.5" />
            Importar exame (PDF)
          </Button>
        </div>
      </div>
      <section
        aria-label="Arquivos de exames do paciente"
        className="mb-4 min-w-0 rounded-xl border border-slate-200/80 bg-white p-3.5"
      >
        <div className="mb-2 flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-800">Arquivos de exames</h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setFilesOpen(true);
            }}
          >
            Ver todos os arquivos
          </Button>
        </div>
        <p className="mb-2 text-xs text-slate-500">
          Os arquivos aparecem aqui desde o envio. Os valores entram no histórico após a conferência
          e confirmação.
        </p>
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
                  onClick={() => {
                    setSelected({
                      scope,
                      source: {
                        documentId: file.sourceId,
                        title: file.title,
                        previewUrl: file.previewUrl,
                        contentType: file.contentType,
                        canReview:
                          files.data?.canUpload === true &&
                          file.sourceKind === "GENERAL_DOCUMENT" &&
                          file.contentType === "application/pdf",
                      },
                    });
                    setCollapsed(false);
                  }}
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
          <p className="py-2 text-xs text-slate-500">Nenhum arquivo de exame anexado.</p>
        )}
        {files.data?.hasMore && (
          <p className="mt-2 text-xs text-slate-500">
            Exibindo os {files.data.documents.length} arquivos mais recentes de {files.data.total}.
            Use “Ver todos os arquivos” para consultar os demais.
          </p>
        )}
      </section>
      <div
        className={`grid min-w-0 items-start gap-4 ${collapsed ? "min-[1400px]:grid-cols-[minmax(0,1fr)_44px]" : "min-[1400px]:grid-cols-[minmax(0,1fr)_280px] min-[1700px]:grid-cols-[minmax(0,1fr)_320px]"}`}
      >
        <div className="min-w-0 rounded-xl border border-slate-200/80 bg-white p-3.5">
          <LaboratoryHistory
            key={scope}
            patientId={patientId}
            unitId={unitId}
            compact
            active={active}
            onOpenOriginal={openOriginal}
          />
        </div>
        <aside
          aria-label="Documento original do exame"
          className="min-w-0 rounded-xl border border-slate-200/80 bg-white"
        >
          <div
            className={`flex h-11 items-center gap-2 border-b border-slate-200/80 ${collapsed ? "justify-center px-1" : "justify-between px-3"}`}
          >
            {!collapsed && (
              <h3 className="flex items-center gap-2 text-xs font-semibold text-slate-800">
                <FileText className="h-3.5 w-3.5 text-teal-700" />
                Documento original
              </h3>
            )}
            <div className="flex items-center gap-1">
              {download && !collapsed && (
                <a
                  href={download}
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 px-2 text-[11px] text-slate-700"
                >
                  <Download className="h-3 w-3" />
                  Baixar
                </a>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                aria-label={
                  collapsed ? "Expandir documento original" : "Recolher documento original"
                }
                aria-expanded={!collapsed}
                onClick={() => setCollapsed((value) => !value)}
              >
                {collapsed ? (
                  <PanelRightOpen className="h-3.5 w-3.5" />
                ) : (
                  <PanelRightClose className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>
          </div>
          {!collapsed && (
            <div className="space-y-3 p-3">
              {source && url ? (
                <>
                  <p className="break-words text-xs font-medium text-slate-700">{source.title}</p>
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
                    className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-slate-50 py-2 text-xs text-slate-700"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Abrir original em nova janela
                  </a>
                  <p className="text-[10px] leading-relaxed text-slate-500">
                    Use os controles do visualizador de PDF para navegar, ampliar ou imprimir.
                  </p>
                </>
              ) : (
                <div className="flex min-h-80 flex-col items-center justify-center gap-3 rounded-lg bg-slate-50 p-6 text-center">
                  <FileText className="h-8 w-8 text-slate-300" />
                  <p className="text-xs leading-relaxed text-slate-500">
                    Selecione um arquivo acima ou “PDF” em um resultado confirmado para abrir o
                    original e conferir os resultados.
                  </p>
                </div>
              )}
            </div>
          )}
        </aside>
      </div>
      <Dialog
        open={filesOpen}
        onOpenChange={(value) => {
          if (
            !value &&
            !window.dispatchEvent(
              new CustomEvent("allik:before-clinical-file-close", {
                cancelable: true,
                detail: { patientId },
              }),
            )
          )
            return;
          setFilesOpen(value);
          if (!value) void files.refetch();
        }}
      >
        <DialogContent
          ref={filesDialog}
          onScroll={(event) => {
            filesScroll.current = event.currentTarget.scrollTop;
          }}
          className="max-h-[92dvh] w-[calc(100%-1rem)] max-w-[1400px] overflow-y-auto"
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
