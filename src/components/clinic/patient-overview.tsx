import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  Activity,
  CalendarDays,
  ClipboardCheck,
  FileClock,
  FlaskConical,
  Pill,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useInventory } from "@/data/inventory-api";
import {
  laboratoryHistoryDate,
  laboratoryHistoryReference,
  type LaboratoryHistoryEntry,
} from "@/lib/laboratory-history";
import type { PatientEncounterSummary } from "./patient-encounter-history";

type OverviewTreatment = {
  id: string;
  productName: string;
  doseQuantity: string;
  doseUnit: string;
  status: string;
  route: string;
};
type OverviewNote = {
  evolution: string;
  diagnosticHypotheses: string;
  finalizedAt: string;
  authorName: string;
  clinicalPlan: string;
  returnRecommendation: string;
  returnOn: string | null;
};
export type PatientOverviewProps = {
  patientId: string;
  treatments: OverviewTreatment[];
  encounters: PatientEncounterSummary[];
  latestNote?: OverviewNote | undefined;
  allergyReviewPending: boolean;
  unverifiedApplications: number;
  onClinicalSummary: () => void;
  onExams: () => void;
  onTreatments: () => void;
  onEncounters: () => void;
};
const dateLabel = (value: string, time = false) =>
  new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    ...(time ? { timeStyle: "short" as const } : {}),
    timeZone: "America/Fortaleza",
  }).format(new Date(value.length === 10 ? `${value}T12:00:00Z` : value));

export function PatientOverviewVitals({
  note,
}: {
  note: {
    systolicPressure: number | null;
    diastolicPressure: number | null;
    heartRate: number | null;
    oxygenSaturation: string | null;
    temperatureC: string | null;
    weightKg: string | null;
    heightCm: string | null;
    finalizedAt: string;
    unitName?: string;
  };
}) {
  const values = [
    note.systolicPressure != null && note.diastolicPressure != null
      ? `PA ${note.systolicPressure}/${note.diastolicPressure} mmHg`
      : null,
    note.heartRate != null ? `FC ${note.heartRate} bpm` : null,
    note.oxygenSaturation != null ? `SpO₂ ${note.oxygenSaturation}%` : null,
    note.temperatureC != null ? `T ${note.temperatureC} °C` : null,
    note.weightKg != null ? `Peso ${note.weightKg} kg` : null,
    note.heightCm != null ? `Altura ${note.heightCm} cm` : null,
  ].filter((value): value is string => value !== null);
  return (
    <div className="space-y-1 text-xs text-slate-600">
      {values.length ? (
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          {values.map((value) => (
            <span key={value}>{value}</span>
          ))}
        </div>
      ) : (
        <p>Sinais vitais não informados</p>
      )}
      <p className="text-[10px] text-slate-400">
        Registro finalizado (não é o horário da medição):{" "}
        {new Date(note.finalizedAt).toLocaleDateString("pt-BR", { timeZone: "America/Fortaleza" })}
        {note.unitName ? ` · ${note.unitName}` : ""}
      </p>
    </div>
  );
}

function OverviewPanel({
  title,
  icon,
  action,
  children,
  className = "",
}: {
  title: string;
  icon: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`min-w-0 rounded-[10px] border border-slate-200/80 bg-white p-4 ${className}`}
      aria-label={title}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-[13px] font-semibold text-slate-900">
          <span className="text-teal-700">{icon}</span>
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}
function CompactAction({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 rounded bg-teal-50 px-1.5 py-0.5 text-[11px] font-medium text-teal-800 hover:bg-teal-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
    >
      {children}
    </button>
  );
}

/** Overview reads the same published observations and encounter records as the clinical tools. */
export function PatientOverview({
  patientId,
  treatments,
  encounters,
  latestNote,
  allergyReviewPending,
  unverifiedApplications,
  onClinicalSummary,
  onExams,
  onTreatments,
  onEncounters,
}: PatientOverviewProps) {
  const laboratory = useInventory<{ rows: LaboratoryHistoryEntry[]; hasMore: boolean }>(
    `laboratory-history?patientId=${encodeURIComponent(patientId)}&unitId=`,
  );
  const recentResults = (laboratory.data?.rows ?? []).slice(0, 5);
  const activeTreatments = treatments.filter((item) => item.status === "ACTIVE");
  const now = Date.now();
  const upcoming = encounters
    .filter(
      (item) =>
        ["CHECKED_IN", "IN_PROGRESS"].includes(item.status) ||
        (["SCHEDULED", "CONFIRMED"].includes(item.status) && Date.parse(item.startsAt) >= now),
    )
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const drafts = encounters.filter((item) => item.hasOwnDraft);
  const pending = [
    ...(allergyReviewPending ? [{ label: "Conferir alergias", action: onClinicalSummary }] : []),
    ...(drafts.length
      ? [{ label: `${drafts.length} atendimento(s) com rascunho`, action: onEncounters }]
      : []),
    ...(unverifiedApplications
      ? [
          {
            label: `${unverifiedApplications} aplicação(ões) sem receita vigente`,
            action: onTreatments,
          },
        ]
      : []),
  ];
  return (
    <section aria-label="Visão geral do paciente" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3 px-1 pb-1">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-slate-900">Visão geral</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Resumo clínico e acompanhamento longitudinal.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/pacientes/$patientId/prontuario" params={{ patientId }}>
            <FileClock className="size-3.5" /> Histórico completo
          </Link>
        </Button>
      </div>
      <div className="grid min-w-0 gap-3 xl:grid-cols-[1.12fr_1fr_1fr]">
        <OverviewPanel
          title="Resumo clínico"
          icon={<Activity className="size-4" />}
          action={<CompactAction onClick={onClinicalSummary}>Ver mais</CompactAction>}
        >
          {latestNote ? (
            <>
              <p className="line-clamp-5 whitespace-pre-line text-xs leading-relaxed text-slate-600">
                {latestNote.diagnosticHypotheses ||
                  latestNote.evolution ||
                  "Evolução finalizada sem texto de resumo."}
              </p>
              <p className="mt-3 text-[11px] text-slate-400">
                Última evolução · {dateLabel(latestNote.finalizedAt)} · {latestNote.authorName}
              </p>
            </>
          ) : (
            <p className="text-xs leading-relaxed text-slate-500">
              Ainda não há evolução clínica finalizada. Consulte os antecedentes e alertas
              registrados.
            </p>
          )}
        </OverviewPanel>
        <OverviewPanel
          title="Exames recentes"
          icon={<FlaskConical className="size-4" />}
          action={<CompactAction onClick={onExams}>Ver todos</CompactAction>}
        >
          {laboratory.isPending ? (
            <p className="text-xs text-slate-500" role="status">
              Carregando resultados confirmados…
            </p>
          ) : laboratory.error ? (
            <div className="space-y-2">
              <p className="text-xs text-slate-500">Resultados indisponíveis para este acesso.</p>
              <button
                type="button"
                className="text-xs text-teal-700 underline"
                onClick={() => laboratory.refetch()}
              >
                Tentar novamente
              </button>
            </div>
          ) : recentResults.length ? (
            <ul className="space-y-2">
              {recentResults.map((entry) => {
                const status = laboratoryHistoryReference(entry);
                const date = laboratoryHistoryDate(entry);
                return (
                  <li key={entry.id}>
                    <button
                      type="button"
                      onClick={onExams}
                      className="flex w-full items-center gap-2 text-left text-[11px] hover:text-teal-800"
                    >
                      <span
                        className={`size-1.5 shrink-0 rounded-full ${status === "within" ? "bg-teal-500" : status === "high" || status === "low" ? "bg-amber-500" : "bg-slate-300"}`}
                        aria-label={
                          status === "within"
                            ? "Dentro da referência"
                            : status === "unknown"
                              ? "Referência não comparável"
                              : "Fora da referência"
                        }
                      />
                      <span className="min-w-0 flex-1 truncate">{entry.payload.name}</span>
                      <span className="max-w-28 truncate font-medium">
                        {entry.payload.result}{" "}
                        <span className="font-normal text-slate-500">{entry.payload.unit}</span>
                      </span>
                      <time className="shrink-0 text-slate-400">
                        {date ? dateLabel(date) : "Sem data"}
                      </time>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-xs leading-relaxed text-slate-500">
              Nenhum resultado confirmado disponível. Exames em revisão permanecem fora deste
              resumo.
            </p>
          )}
        </OverviewPanel>
        <OverviewPanel
          title="Tratamentos ativos"
          icon={<Pill className="size-4" />}
          action={<CompactAction onClick={onTreatments}>Ver todos</CompactAction>}
        >
          {activeTreatments.length ? (
            <ul className="space-y-2.5">
              {activeTreatments.slice(0, 5).map((item) => (
                <li key={item.id} className="flex gap-2 text-xs">
                  <Pill className="mt-0.5 size-3 shrink-0 text-slate-400" />
                  <div>
                    <p className="font-medium text-slate-700">{item.productName}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {item.doseQuantity} {item.doseUnit} · {item.route}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs leading-relaxed text-slate-500">
              Nenhum tratamento marcado como ativo.
            </p>
          )}
        </OverviewPanel>
      </div>
      <div className="grid gap-3 xl:grid-cols-[1.25fr_1fr]">
        <OverviewPanel
          title="Próximas consultas"
          icon={<CalendarDays className="size-4" />}
          action={<CompactAction onClick={onEncounters}>Ver consultas</CompactAction>}
        >
          {upcoming.length ? (
            <ul className="divide-y divide-slate-100">
              {upcoming.slice(0, 3).map((item) => (
                <li key={item.id} className="flex flex-wrap items-center gap-3 py-2 first:pt-0">
                  <div className="rounded-md bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-700">
                    {dateLabel(item.startsAt, true)}
                  </div>
                  <div className="min-w-0 flex-1 text-xs">
                    <p className="font-medium">
                      {item.careTypeName === "CONSULTATION"
                        ? "Consulta"
                        : item.careTypeName === "FOLLOW_UP"
                          ? "Retorno"
                          : item.careTypeName === "FIRST_VISIT"
                            ? "Primeira consulta"
                            : item.careTypeName === "TELECONSULTATION"
                              ? "Teleconsulta"
                              : item.careTypeName === "INJECTABLE"
                                ? "Injetável"
                                : item.careTypeName === "OTHER"
                                  ? "Outro atendimento"
                                  : item.careTypeName}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-slate-500">
                      {item.professionalName} · {item.unitName}
                    </p>
                  </div>
                  <Link
                    className="rounded-md bg-teal-50 px-2 py-1 text-[11px] font-medium text-teal-800"
                    to="/atendimentos/$appointmentId"
                    params={{ appointmentId: item.id }}
                  >
                    {item.status === "IN_PROGRESS"
                      ? "Em atendimento"
                      : item.status === "CONFIRMED"
                        ? "Confirmada"
                        : item.status === "CHECKED_IN"
                          ? "Paciente presente"
                          : "Agendada"}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-slate-500">
              Nenhuma consulta em aberto no histórico disponível.
            </p>
          )}
        </OverviewPanel>
        <OverviewPanel title="Pendências" icon={<ShieldAlert className="size-4" />}>
          {pending.length ? (
            <ul className="grid gap-2 sm:grid-cols-2">
              {pending.map((item) => (
                <li key={item.label}>
                  <button
                    type="button"
                    onClick={item.action}
                    className="flex items-start gap-2 text-left text-xs text-slate-600 hover:text-teal-800"
                  >
                    <span className="mt-1 size-1.5 shrink-0 rounded-full bg-amber-400" />
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="flex items-center gap-2 text-xs text-slate-500">
              <ClipboardCheck className="size-4 text-teal-600" />
              Sem pendências nesses registros.
            </p>
          )}
          <p className="mt-3 text-[10px] text-slate-400">
            Baseado nas consultas, alergias e aplicações disponíveis. Tarefas da equipe são
            acompanhadas separadamente.
          </p>
        </OverviewPanel>
      </div>
      {latestNote &&
      (latestNote.clinicalPlan || latestNote.returnRecommendation || latestNote.returnOn) ? (
        <OverviewPanel
          title="Último plano e retorno"
          icon={<ClipboardCheck className="size-4" />}
          action={<CompactAction onClick={onEncounters}>Abrir registro</CompactAction>}
        >
          <div className="grid gap-4 text-xs leading-relaxed text-slate-600 md:grid-cols-2">
            <p className="line-clamp-4 whitespace-pre-line">
              {latestNote.clinicalPlan || "Plano não informado na última evolução."}
            </p>
            <div>
              <p className="line-clamp-4 whitespace-pre-line">
                {latestNote.returnRecommendation || "Orientação de retorno não informada."}
              </p>
              {latestNote.returnOn && (
                <p className="mt-2 font-medium text-teal-800">
                  Retorno sugerido: {dateLabel(latestNote.returnOn)}
                </p>
              )}
            </div>
          </div>
        </OverviewPanel>
      ) : null}
    </section>
  );
}
