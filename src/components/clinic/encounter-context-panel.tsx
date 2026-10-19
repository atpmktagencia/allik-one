import { useMemo, useState, type ReactNode } from "react";
import {
  ClipboardList,
  FileText,
  FolderOpen,
  NotebookPen,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useInventory } from "@/data/inventory-api";
import {
  laboratoryHistoryDate,
  laboratoryHistoryReference,
  type LaboratoryHistoryEntry,
} from "@/lib/laboratory-history";

type Target = "exams" | "documents" | "questionnaires";
export type EncounterContextProps = {
  patientId: string;
  unitId?: string | undefined;
  onNavigate?: (target: Target) => void;
  onQuickNote?: () => void;
  quickNotes?: ReactNode;
  onCollapseChange?: (collapsed: boolean) => void;
};
function resource(name: string, patientId: string, unitId?: string) {
  const params = new URLSearchParams({ patientId });
  if (unitId) params.set("unitId", unitId);
  return `${name}?${params}`;
}
function date(value: string | null | undefined) {
  return value ? value.slice(0, 10).split("-").reverse().join("/") : "Sem data";
}
function ContextSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200/80 bg-white p-3">
      <h3 className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-slate-900">
        <ClipboardList className="h-4 w-4 text-teal-700" />
        {title}
      </h3>
      {children}
    </section>
  );
}
function DocumentCategory({
  patientId,
  unitId,
  category,
  label,
  onOpen,
}: {
  patientId: string;
  unitId?: string | undefined;
  category: string;
  label: string;
  onOpen?: (() => void) | undefined;
}) {
  const query = useInventory<{ total: number }>(
    `${resource("patient-documents", patientId, unitId)}&limit=1&category=${category}`,
  );
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!onOpen}
      className="flex min-h-9 w-full items-center gap-2 border-b border-slate-100 text-left text-xs text-slate-600 last:border-0 hover:text-teal-700 disabled:cursor-default"
    >
      <FileText className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1">{label}</span>
      <span
        className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px]"
        title={query.error ? "Não foi possível consultar a contagem" : undefined}
      >
        {query.error ? "—" : (query.data?.total ?? "…")}
      </span>
    </button>
  );
}
export function EncounterContextPanel({
  patientId,
  unitId,
  onNavigate,
  onQuickNote,
  quickNotes,
  onCollapseChange,
}: EncounterContextProps) {
  const [collapsed, setCollapsed] = useState(false);
  const labs = useInventory<{ rows: LaboratoryHistoryEntry[]; hasMore: boolean }>(
    resource("laboratory-history", patientId, unitId),
  );
  const questionnaires = useInventory<{
    invitations: {
      id: string;
      title: string;
      submittedAt: string | null;
      revokedAt: string | null;
      expiresAt: string;
    }[];
  }>(resource("preconsultation", patientId, unitId));
  const recent = useMemo(
    () =>
      [...(labs.data?.rows ?? [])]
        .sort((a, b) =>
          (laboratoryHistoryDate(b) ?? "").localeCompare(laboratoryHistoryDate(a) ?? ""),
        )
        .slice(0, 5),
    [labs.data],
  );
  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    onCollapseChange?.(next);
  }
  return (
    <aside
      aria-label="Contexto clínico do paciente"
      className="min-w-0 rounded-xl border border-slate-200/80 bg-white"
    >
      <div
        className={`flex h-11 items-center border-b border-slate-200/80 ${collapsed ? "justify-center px-1" : "justify-between px-3"}`}
      >
        {!collapsed && (
          <span className="flex h-full items-center border-b-2 border-teal-600 px-3 text-[13px] font-semibold text-teal-700">
            Contexto
          </span>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-slate-500"
          aria-label={collapsed ? "Expandir painel contextual" : "Recolher painel contextual"}
          aria-expanded={!collapsed}
          onClick={toggle}
        >
          {collapsed ? (
            <PanelRightOpen className="h-4 w-4" />
          ) : (
            <PanelRightClose className="h-4 w-4" />
          )}
        </Button>
      </div>
      {!collapsed && (
        <div className="space-y-2.5 p-2.5">
          <ContextSection title="Exames recentes">
            {labs.error ? (
              <p role="status" className="text-xs text-muted-foreground">
                Não foi possível consultar os exames.{" "}
                <button type="button" className="underline" onClick={() => void labs.refetch()}>
                  Tentar novamente
                </button>
              </p>
            ) : !labs.data ? (
              <p className="text-xs text-muted-foreground">Consultando resultados…</p>
            ) : !recent.length ? (
              <p className="py-2 text-xs text-muted-foreground">Nenhum resultado confirmado.</p>
            ) : (
              <ul>
                {recent.map((entry) => {
                  const status = laboratoryHistoryReference(entry);
                  return (
                    <li
                      key={entry.id}
                      className="flex items-start gap-2 border-b border-slate-100 py-2 text-xs last:border-0"
                    >
                      <span
                        className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${status === "high" || status === "low" ? "bg-amber-500" : status === "within" ? "bg-emerald-600" : "bg-slate-400"}`}
                        title={
                          status === "unknown"
                            ? "Sem referência comparável"
                            : status === "within"
                              ? "Dentro da referência do laboratório"
                              : "Fora da referência do laboratório"
                        }
                      />
                      <span className="min-w-0 flex-1 text-slate-800">{entry.payload.name}</span>
                      <span className="max-w-24 text-right text-slate-700">
                        {entry.payload.result}{" "}
                        <span className="text-slate-500">{entry.payload.unit}</span>
                      </span>
                      <span className="shrink-0 text-[10px] text-slate-500">
                        {date(laboratoryHistoryDate(entry))}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            {labs.data?.hasMore && (
              <p className="mt-1 text-[10px] text-slate-500">Há mais resultados no histórico.</p>
            )}
            {onNavigate && (
              <Button
                variant="outline"
                className="mt-2 h-8 w-full bg-slate-50/70 text-xs"
                onClick={() => onNavigate("exams")}
              >
                Abrir exames em painel
              </Button>
            )}
          </ContextSection>
          <ContextSection title="Documentos do paciente">
            <DocumentCategory
              patientId={patientId}
              unitId={unitId}
              category="LAB_RESULT"
              label="Exames laboratoriais"
              onOpen={onNavigate ? () => onNavigate("documents") : undefined}
            />
            <DocumentCategory
              patientId={patientId}
              unitId={unitId}
              category="PRESCRIPTION"
              label="Receitas e prescrições"
              onOpen={onNavigate ? () => onNavigate("documents") : undefined}
            />
            <DocumentCategory
              patientId={patientId}
              unitId={unitId}
              category="MEDICAL_REPORT"
              label="Relatórios médicos"
              onOpen={onNavigate ? () => onNavigate("documents") : undefined}
            />
            <DocumentCategory
              patientId={patientId}
              unitId={unitId}
              category="OTHER"
              label="Outros documentos"
              onOpen={onNavigate ? () => onNavigate("documents") : undefined}
            />
            {onNavigate && (
              <Button
                variant="outline"
                className="mt-2 h-8 w-full bg-slate-50/70 text-xs"
                onClick={() => onNavigate("documents")}
              >
                <FolderOpen className="mr-2 h-3.5 w-3.5" />
                Gerenciar arquivos
              </Button>
            )}
          </ContextSection>
          <ContextSection title="Questionários">
            {questionnaires.error ? (
              <p className="text-xs text-muted-foreground">Questionários indisponíveis.</p>
            ) : !questionnaires.data ? (
              <p className="text-xs text-muted-foreground">Consultando questionários…</p>
            ) : !questionnaires.data.invitations.length ? (
              <p className="py-2 text-xs text-muted-foreground">Nenhum questionário enviado.</p>
            ) : (
              <ul>
                {questionnaires.data.invitations.slice(0, 3).map((item) => {
                  const status = item.submittedAt
                    ? "Respondido"
                    : item.revokedAt
                      ? "Revogado"
                      : new Date(item.expiresAt).getTime() <= Date.now()
                        ? "Expirado"
                        : "Pendente";
                  return (
                    <li
                      key={item.id}
                      className="flex items-center justify-between gap-2 border-b border-slate-100 py-2 text-xs last:border-0"
                    >
                      <span className="min-w-0 text-slate-700">{item.title}</span>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${item.submittedAt ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}
                      >
                        {status}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            {onNavigate && (
              <Button
                variant="outline"
                className="mt-2 h-8 w-full bg-slate-50/70 text-xs"
                onClick={() => onNavigate("questionnaires")}
              >
                Consultar ou enviar questionário
              </Button>
            )}
          </ContextSection>
          <ContextSection title="Anotações rápidas">
            {quickNotes ?? (
              <>
                <p className="text-xs leading-relaxed text-slate-500">
                  Registre as anotações na evolução para mantê-las vinculadas ao atendimento.
                </p>
                {onQuickNote && (
                  <Button
                    variant="outline"
                    className="mt-2 h-8 w-full bg-slate-50/70 text-xs"
                    onClick={onQuickNote}
                  >
                    <NotebookPen className="mr-2 h-3.5 w-3.5" />
                    Registrar na evolução
                  </Button>
                )}
              </>
            )}
          </ContextSection>
        </div>
      )}
    </aside>
  );
}
