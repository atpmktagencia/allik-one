import { PatientNewEncounter } from "./patient-new-encounter";
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

export function PatientTimelinePage({ patientId }: { patientId: string }) {
  const [kind, setKind] = useState("");
  const unitId = useSyncExternalStore(subscribeUnit, selectedUnitId, () => "");
  const path = withSelectedUnit(
    `/api/v1/inventory/patient-timeline?patientId=${encodeURIComponent(patientId)}${kind ? `&kind=${kind}` : ""}`,
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
  const groups = new Map<string, TimelineEvent[]>();
  for (const event of events) {
    const day = dateLabel(event.occurredAt);
    groups.set(day, [...(groups.get(day) ?? []), event]);
  }
  if (!patient)
    return (
      <InventoryState pending={query.isPending} error={query.error} retry={() => query.refetch()} />
    );
  return (
    <div className="clinical-workspace mx-auto max-w-5xl space-y-6 rounded-2xl bg-background p-4 sm:p-6">
      <header className="space-y-4 rounded-2xl border bg-card p-5">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/pacientes/$patientId" params={{ patientId }}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Cadastro do paciente
          </Link>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">Prontuário longitudinal</p>
            <h1 className="mt-1 text-2xl font-semibold">{patient.name}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {patient.internalCode} · {patient.unitName}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">Histórico clínico</Badge>
            {query.data?.pages[0]?.canCreateEncounter && (
              <PatientNewEncounter patientId={patientId} unitId={patient.primaryUnitId} />
            )}
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Consulte atendimentos, registros clínicos finalizados e a trajetória do tratamento.
        </p>
      </header>
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="timeline-kind" className="text-sm font-medium">
          Mostrar
        </label>
        <select
          id="timeline-kind"
          value={kind}
          onChange={(event) => setKind(event.target.value)}
          className="min-h-10 max-w-full rounded-md border bg-white px-3 text-sm"
        >
          <option value="">Todos os registros</option>
          {Object.entries(eventKinds).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {query.isFetching && !query.isFetchingNextPage && (
        <p role="status" className="text-sm text-muted-foreground">
          Atualizando histórico…
        </p>
      )}
      {!events.length && (
        <div className="rounded-2xl border p-8 text-center">
          <FileText className="mx-auto mb-3 h-6 w-6 text-muted-foreground" />
          <h2 className="font-semibold">Nenhum registro encontrado</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Os registros aparecerão aqui conforme os atendimentos e tratamentos forem realizados.
          </p>
        </div>
      )}
      {[...groups].map(([day, items]) => (
        <section key={day} aria-label={day} className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">{day}</h2>
          {items.map((event) => (
            <article
              key={`${event.kind}-${event.id}`}
              className="rounded-2xl border bg-white p-4 sm:p-5"
            >
              <div className="flex flex-wrap justify-between gap-2">
                <h3 className="font-semibold">{event.title}</h3>
                <Badge variant="outline">{eventKinds[event.kind]}</Badge>
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
                {event.appointmentId && (
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
            {query.isFetchingNextPage ? "Carregando registros…" : "Carregar registros anteriores"}
          </Button>
        </div>
      )}
    </div>
  );
}
