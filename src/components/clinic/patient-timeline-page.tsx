import { PatientAllergySummary } from "./patient-allergy-summary";
import type { AllergySummary } from "@/lib/patient-allergies";
import { PatientNewEncounter } from "./patient-new-encounter";
import { PatientWorkspaceNavigation } from "./patient-workspace-navigation";
import { ClinicalPatientHeader } from "./clinical-patient-header";
import { useState, useSyncExternalStore } from "react";
import "./clinical-workspace.css";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { readInventoryResponse } from "@/data/inventory-api";
import { selectedUnitId, withSelectedUnit } from "@/data/unit-context";
import { InventoryState } from "./inventory-state";

const eventKinds = {
  APPOINTMENT: "Agendamentos",
  CLINICAL_NOTE: "Evoluções clínicas",
  PRESCRIPTION: "Prescrições",
  DOCUMENT: "Documentos",
  TREATMENT: "Planos terapêuticos",
  APPLICATION: "Aplicações",
} as const;
type EventKind = keyof typeof eventKinds;
type TimelineEvent = {
  id: string;
  kind: EventKind;
  title: string;
  occurredAt: string;
  authorName: string | null;
  unitName: string;
  status: string;
  appointmentId?: string;
  documentId?: string;
  summary: string;
  content?: string;
};
type TimelinePayload = {
  allergySummary?: AllergySummary;
  patient: {
    id: string;
    name: string;
    internalCode: string;
    unitName: string;
    primaryUnitId: string;
  };
  events: TimelineEvent[];
  nextCursor: string | null;
  canCreateEncounter?: boolean;
};

function subscribeUnit(callback: () => void) {
  window.addEventListener("inventory-unit-change", callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener("inventory-unit-change", callback);
    window.removeEventListener("storage", callback);
  };
}

function dateLabel(value: string, includeTime = false) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "long",
    ...(includeTime ? { timeStyle: "short" as const } : {}),
    timeZone: "America/Fortaleza",
  }).format(new Date(value));
}

export function PatientTimelinePage({
  patientId,
  embedded = false,
  unitId: scopedUnitId,
}: {
  patientId: string;
  embedded?: boolean;
  unitId?: string;
}) {
  const [kind, setKind] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [origin, setOrigin] = useState("");
  const [author, setAuthor] = useState("");
  const unitId = useSyncExternalStore(subscribeUnit, selectedUnitId, () => "");
  const path = withSelectedUnit(
    `/api/v1/inventory/patient-timeline?patientId=${encodeURIComponent(patientId)}${kind ? `&kind=${kind}` : ""}${from ? `&from=${encodeURIComponent(from)}` : ""}${to ? `&to=${encodeURIComponent(to)}` : ""}${scopedUnitId ? `&unitId=${encodeURIComponent(scopedUnitId)}` : ""}`,
  );
  const query = useInfiniteQuery({
    queryKey: ["inventory", "patient-timeline", unitId, path],
    initialPageParam: "",
    queryFn: async ({ pageParam }) => {
      const response = await fetch(
        `${path}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`,
        {
          credentials: "same-origin",
        },
      );
      const body = await readInventoryResponse<TimelinePayload>(
        response,
        "Não foi possível consultar o prontuário.",
      );
      if (!body.data) throw new Error("O servidor não retornou os dados do prontuário.");
      return body.data;
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    retry: false,
  });
  const patient = query.data?.pages[0]?.patient;
  const events = query.data?.pages.flatMap((page) => page.events) ?? [];
  const origins = [...new Set(events.map((event) => event.unitName).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "pt-BR"),
  );
  const visibleEvents = events.filter((event) => {
    const matchesOrigin = !origin || event.unitName === origin;
    const matchesAuthor =
      !author ||
      event.authorName?.toLocaleLowerCase("pt-BR").includes(author.toLocaleLowerCase("pt-BR"));
    return matchesOrigin && matchesAuthor;
  });
  const groups = new Map<string, TimelineEvent[]>();
  for (const event of visibleEvents) {
    const day = dateLabel(event.occurredAt);
    groups.set(day, [...(groups.get(day) ?? []), event]);
  }
  if (!patient)
    return (
      <InventoryState pending={query.isPending} error={query.error} retry={() => query.refetch()} />
    );
  return (
    <div className="clinical-workspace patient-workspace mx-auto w-full min-w-0 space-y-4 bg-background p-3 sm:p-5">
      {!embedded && (
        <>
          <h1 className="sr-only">Histórico clínico de {patient.name} · Paciente360º</h1>
          <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-slate-500">
            <div className="flex items-center gap-2">
              <Link
                to="/pacientes/$patientId"
                params={{ patientId }}
                className="inline-flex items-center gap-1 hover:text-teal-800"
              >
                <ArrowLeft className="size-3.5" /> Paciente360º
              </Link>
              <span aria-hidden="true">›</span>
              <span className="font-semibold text-slate-900">Histórico</span>
            </div>
            <span>Prontuário longitudinal · {patient.unitName}</span>
          </div>
          <ClinicalPatientHeader
            name={patient.name}
            code={patient.internalCode}
            unitName={patient.unitName}
            secondaryInfo="Prontuário longitudinal"
            allergies={
              query.data?.pages[0]?.allergySummary ? (
                <div className="[&>section]:border-0 [&>section]:p-0 [&_p]:text-[11px] [&_button]:h-7 [&_button]:px-2 [&_button]:text-[10px]">
                  <PatientAllergySummary
                    patientId={patientId}
                    summary={query.data.pages[0].allergySummary!}
                  />
                </div>
              ) : undefined
            }
          />
          <p className="px-1 text-xs text-slate-500">
            Eventos de agenda e registros clínicos são identificados separadamente, com data,
            autoria e unidade de origem. O rascunho da consulta atual não entra nesta linha do
            tempo.
          </p>
        </>
      )}
      {embedded && (
        <p className="text-xs text-muted-foreground">
          Histórico somente leitura · unidade deste atendimento. Seu rascunho permanece aberto.
        </p>
      )}
      <div className={embedded ? "" : "grid min-w-0 gap-3 lg:grid-cols-[206px_minmax(0,1fr)]"}>
        {!embedded && (
          <PatientWorkspaceNavigation
            patient={{
              fullName: patient.name,
              internalCode: patient.internalCode,
              unitName: patient.unitName,
            }}
            patientId={patientId}
            section="history"
            onSelect={() => undefined}
            hrefForSection={(nextSection) =>
              `/pacientes/${encodeURIComponent(patientId)}#secao=${nextSection}`
            }
          />
        )}
        <main className="min-w-0 space-y-4" aria-label="Linha do tempo do paciente">
          <section
            className="space-y-3 rounded-xl border border-slate-200/80 bg-white p-4"
            aria-label="Filtros do histórico"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-semibold text-slate-900">Histórico clínico</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Filtros aplicados apenas a dados fornecidos pelo prontuário.
                </p>
              </div>
              {!embedded && query.data?.pages[0]?.canCreateEncounter && (
                <PatientNewEncounter patientId={patientId} unitId={patient.primaryUnitId} />
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <label className="space-y-1 text-sm font-medium">
                Mostrar
                <select
                  id="timeline-kind"
                  aria-label="Tipo do registro"
                  value={kind}
                  onChange={(event) => setKind(event.target.value)}
                  className="h-10 w-full rounded-md border bg-white px-3 text-sm"
                >
                  <option value="">Todos os registros</option>
                  {Object.entries(eventKinds).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm font-medium">
                De
                <input
                  type="date"
                  aria-label="Data inicial"
                  value={from}
                  max={to || undefined}
                  onChange={(event) => setFrom(event.target.value)}
                  className="h-10 w-full rounded-md border bg-white px-3 text-sm"
                />
              </label>
              <label className="space-y-1 text-sm font-medium">
                Até
                <input
                  type="date"
                  aria-label="Data final"
                  value={to}
                  min={from || undefined}
                  onChange={(event) => setTo(event.target.value)}
                  className="h-10 w-full rounded-md border bg-white px-3 text-sm"
                />
              </label>
              <label className="space-y-1 text-sm font-medium">
                Origem
                <select
                  aria-label="Origem do registro"
                  value={origin}
                  onChange={(event) => setOrigin(event.target.value)}
                  className="h-10 w-full rounded-md border bg-white px-3 text-sm"
                >
                  <option value="">Todas as unidades</option>
                  {origins.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm font-medium">
                Autoria
                <input
                  type="search"
                  aria-label="Autoria do registro"
                  value={author}
                  onChange={(event) => setAuthor(event.target.value)}
                  placeholder="Todos os autores"
                  className="h-10 w-full rounded-md border bg-white px-3 text-sm"
                />
              </label>
            </div>
            {(kind || from || to || origin || author) && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setKind("");
                  setFrom("");
                  setTo("");
                  setOrigin("");
                  setAuthor("");
                }}
              >
                Limpar filtros
              </Button>
            )}
          </section>
          {(origin || author) && query.hasNextPage && (
            <p
              role="status"
              className="rounded-lg border bg-slate-50 px-3 py-2 text-xs text-muted-foreground"
            >
              Origem e autoria filtram somente os registros já carregados. Use “Carregar registros
              anteriores” para incluir mais eventos nesta busca.
            </p>
          )}
          {query.isFetching && !query.isFetchingNextPage && (
            <p role="status" className="text-sm text-muted-foreground">
              Atualizando histórico…
            </p>
          )}
          {!visibleEvents.length && (
            <div className="rounded-2xl border p-8 text-center">
              <FileText className="mx-auto mb-3 h-6 w-6 text-muted-foreground" />
              <h2 className="font-semibold">Nenhum registro encontrado</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Os registros aparecerão aqui conforme os atendimentos e tratamentos forem
                realizados.
              </p>
            </div>
          )}
          {[...groups].map(([day, items]) => (
            <section key={day} aria-label={day} className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground">{day}</h2>
              {items.map((event) => (
                <article
                  key={`${event.kind}-${event.id}`}
                  className={`rounded-xl border bg-white p-4 sm:p-5 ${event.kind === "APPOINTMENT" ? "border-l-4 border-l-slate-300" : "border-l-4 border-l-teal-500"}`}
                >
                  <div className="flex flex-wrap justify-between gap-2">
                    <h3 className="font-semibold">{event.title}</h3>
                    <Badge variant="outline">
                      {event.kind === "APPOINTMENT" ? "Agenda · " : "Clínico · "}
                      {eventKinds[event.kind]}
                    </Badge>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {dateLabel(event.occurredAt, true)} · {event.unitName}
                    {event.authorName ? ` · ${event.authorName}` : ""}
                  </p>
                  <p className="mt-3 whitespace-pre-wrap text-sm">{event.summary}</p>
                  {event.content && (
                    <details className="mt-4">
                      <summary className="cursor-pointer text-sm font-medium text-primary">
                        Ler registro completo
                      </summary>
                      <div className="mt-3 whitespace-pre-wrap break-words rounded-lg border bg-muted/20 p-4 text-sm leading-7">
                        {event.content}
                      </div>
                    </details>
                  )}
                  <div className="mt-4 flex flex-wrap gap-3">
                    {!embedded && event.appointmentId && (
                      <Button variant="outline" size="sm" asChild>
                        <Link
                          to="/atendimentos/$appointmentId"
                          params={{ appointmentId: event.appointmentId }}
                        >
                          Abrir atendimento
                        </Link>
                      </Button>
                    )}
                    {event.documentId && event.status === "FINAL" && (
                      <Button variant="outline" size="sm" asChild>
                        <a
                          href={`/api/v1/inventory/encounter-documents?documentId=${encodeURIComponent(event.documentId)}&print=true`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Imprimir documento
                        </a>
                      </Button>
                    )}
                  </div>
                </article>
              ))}
            </section>
          ))}
          {query.error && (
            <InventoryState
              error={query.error}
              retry={() => (query.hasNextPage ? query.fetchNextPage() : query.refetch())}
            />
          )}
          {query.hasNextPage && (
            <div className="text-center">
              <Button
                variant="outline"
                disabled={query.isFetchingNextPage}
                onClick={() => query.fetchNextPage()}
              >
                {query.isFetchingNextPage
                  ? "Carregando registros…"
                  : "Carregar registros anteriores"}
              </Button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
