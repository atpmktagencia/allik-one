import { useEffect, useState } from "react";
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
import type { LaboratoryHistoryEntry } from "@/lib/laboratory-history";
import { LaboratoryHistory } from "./laboratory-history";
import { PatientDocumentCenter } from "./patient-document-center";
import { PrivateDocumentPreview } from "./private-document-preview";

type Props = {
  patientId: string;
  unitId?: string | undefined;
  onNavigate?: (target: "exams" | "documents" | "questionnaires") => void;
};
function originalUrl(value: string, download = false) {
  if (!value.startsWith("/api/v1/inventory/") || value.startsWith("//")) return null;
  const url = new URL(value, "https://private.invalid");
  if (download) url.searchParams.set("download", "true");
  return withSelectedUnit(`${url.pathname}${url.search}`);
}
export function EncounterExamsPanel({ patientId, unitId }: Props) {
  const [filesOpen, setFilesOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [selected, setSelected] = useState<{ scope: string; entry: LaboratoryHistoryEntry } | null>(
    null,
  );
  const scope = `${patientId}:${unitId ?? selectedUnitId()}`;
  const entry = selected?.scope === scope ? selected.entry : null;
  const url = entry ? originalUrl(entry.previewUrl) : null;
  const download = entry ? originalUrl(entry.previewUrl, true) : null;
  useEffect(() => {
    const reset = () => {
      setSelected(null);
      setFilesOpen(false);
    };
    window.addEventListener("inventory-unit-change", reset);
    return () => window.removeEventListener("inventory-unit-change", reset);
  }, []);
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
            onClick={() => setFilesOpen(true)}
          >
            Conferir extrações
          </Button>
          <Button
            size="sm"
            className="h-9 bg-teal-700 text-xs hover:bg-teal-800"
            onClick={() => setFilesOpen(true)}
          >
            <Upload className="mr-1.5 h-3.5 w-3.5" />
            Importar exame (PDF)
          </Button>
        </div>
      </div>
      <div
        className={`grid min-w-0 items-start gap-4 ${collapsed ? "min-[1400px]:grid-cols-[minmax(0,1fr)_44px]" : "min-[1400px]:grid-cols-[minmax(0,1fr)_280px] min-[1700px]:grid-cols-[minmax(0,1fr)_320px]"}`}
      >
        <div className="min-w-0 rounded-xl border border-slate-200/80 bg-white p-3.5">
          <LaboratoryHistory
            key={scope}
            patientId={patientId}
            unitId={unitId}
            compact
            onOpenOriginal={(original) => {
              setSelected({ scope, entry: original });
              setCollapsed(false);
            }}
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
              {entry && url ? (
                <>
                  <p className="break-words text-xs font-medium text-slate-700">
                    {entry.documentTitle}
                  </p>
                  <PrivateDocumentPreview
                    key={`${scope}:${entry.documentId}`}
                    document={{
                      title: entry.documentTitle,
                      previewUrl: entry.previewUrl,
                      contentType: "application/pdf",
                    }}
                  />
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-slate-50 py-2 text-xs text-slate-700"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Abrir PDF em nova janela
                  </a>
                  <p className="text-[10px] leading-relaxed text-slate-500">
                    Use os controles do visualizador de PDF para navegar, ampliar ou imprimir.
                  </p>
                </>
              ) : (
                <div className="flex min-h-80 flex-col items-center justify-center gap-3 rounded-lg bg-slate-50 p-6 text-center">
                  <FileText className="h-8 w-8 text-slate-300" />
                  <p className="text-xs leading-relaxed text-slate-500">
                    Selecione “PDF” em um resultado confirmado para conferir o documento original.
                  </p>
                </div>
              )}
            </div>
          )}
        </aside>
      </div>
      <Dialog open={filesOpen} onOpenChange={setFilesOpen}>
        <DialogContent className="max-h-[92dvh] w-[calc(100%-1rem)] max-w-[1400px] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Arquivos e conferência de exames</DialogTitle>
            <DialogDescription>
              Importe o original e confira os resultados antes de incluí-los no histórico clínico.
            </DialogDescription>
          </DialogHeader>
          <PatientDocumentCenter key={scope} patientId={patientId} examsOnly />
        </DialogContent>
      </Dialog>
    </section>
  );
}
