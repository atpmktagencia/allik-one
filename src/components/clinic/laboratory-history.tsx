import { laboratoryScaleReview } from "@/lib/laboratory-scale";
import {
  projectLaboratoryObservations,
  isLaboratoryObservation,
} from "@/lib/laboratory-observations";
import { Fragment, memo, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { laboratoryDisplayGroup, laboratoryDisplayGroups } from "@/lib/laboratory-display-groups";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useInventory } from "@/data/inventory-api";
import { withSelectedUnit } from "@/data/unit-context";
import {
  buildLaboratoryHistory,
  laboratoryHistoryDate,
  type LaboratoryHistoryEntry,
  type LaboratoryHistoryGroup,
} from "@/lib/laboratory-history";
import { groupLaboratoryBiomarkers, type LaboratoryBiomarker } from "@/lib/laboratory-biomarkers";
import {
  longitudinalModes,
  applicableLaboratoryReference,
  longitudinalGraphSeries,
  normalReference,
  laboratoryResultColor,
  laboratoryProvenanceLabel,
  type IdealTargetDraft,
} from "@/lib/laboratory-longitudinal-view";
import { LaboratoryIdealEditor } from "./laboratory-ideal-editor";
import { laboratoryDate } from "@/lib/laboratory-results";
import { InventoryState } from "./inventory-state";

type Payload = { rows: LaboratoryHistoryEntry[]; hasMore: boolean; offset: number };
const labelDate = (date: string) =>
  date === "undated" ? "Sem data de exame" : date.split("-").reverse().join("/");
function ReferenceStatus({
  entry,
  status = applicableLaboratoryReference(entry),
}: {
  entry: LaboratoryHistoryEntry;
  status?: ReturnType<typeof applicableLaboratoryReference> | undefined;
}) {
  const labels = {
    low: "Abaixo da referência laboratorial",
    high: "Acima da referência laboratorial",
    within: "Dentro da referência laboratorial",
    unknown: "Referência não comparável automaticamente",
  };
  return (
    <p
      className={
        status === "low"
          ? "text-xs text-red-700"
          : status === "high"
            ? "text-xs text-red-700"
            : status === "within"
              ? "text-xs text-muted-foreground"
              : "text-xs text-muted-foreground"
      }
    >
      {labels[status]}
    </p>
  );
}
function Source({
  entry,
  onOpenOriginal,
  compact = false,
}: {
  entry: LaboratoryHistoryEntry;
  onOpenOriginal?: ((entry: LaboratoryHistoryEntry) => void) | undefined;
  compact?: boolean;
}) {
  if (onOpenOriginal)
    return (
      <button
        type="button"
        className="text-xs text-teal-700 underline-offset-2 hover:underline"
        aria-label={`Ver original: ${entry.documentTitle}`}
        onClick={() => onOpenOriginal(entry)}
      >
        {compact ? "PDF" : entry.documentTitle}
      </button>
    );
  return (
    <a
      className="text-xs text-primary underline underline-offset-2"
      href={`${withSelectedUnit(entry.previewUrl)}${entry.payload.sourcePage ? `#page=${entry.payload.sourcePage}` : ""}`}
      target="_blank"
      rel="noreferrer"
    >
      {entry.documentTitle}
    </a>
  );
}
const HistoryGraph = memo(function HistoryGraph({
  group,
  onOpenOriginal,
  compatibilityGroups,
}: {
  group: LaboratoryHistoryGroup;
  compatibilityGroups?: LaboratoryHistoryGroup[];
  onOpenOriginal?: ((entry: LaboratoryHistoryEntry) => void) | undefined;
}) {
  const { points, segments } = useMemo(() => {
    const series = (compatibilityGroups ?? [group]).map(longitudinalGraphSeries);
    return {
      points: series.flatMap((s) => s.points).sort((a, b) => a.date.localeCompare(b.date)),
      segments: series.flatMap((s) => s.segments),
    };
  }, [group, compatibilityGroups]);
  const referenceStatuses = useMemo(
    () => new Map(group.entries.map((entry) => [entry.id, applicableLaboratoryReference(entry)])),
    [group],
  );
  if (!points.length)
    return (
      <p className="p-3 text-sm text-muted-foreground">
        Sem ponto numérico confiável e datado para o gráfico.
      </p>
    );
  const times = points.map((p) => Date.parse(p.date + "T00:00:00Z"));
  const values = points.map((p) => p.value);
  const minTime = Math.min(...times),
    maxTime = Math.max(...times);
  const minValue = Math.min(...values),
    maxValue = Math.max(...values);
  const x = (date: string) =>
    55 + ((Date.parse(date + "T00:00:00Z") - minTime) / (maxTime - minTime || 1)) * 590;
  const y = (value: number) =>
    maxValue === minValue ? 90 : 150 - ((value - minValue) / (maxValue - minValue)) * 120;
  const byId = new Map(points.map((p) => [p.id, p]));
  return (
    <div className="space-y-2 p-3">
      <svg
        viewBox="0 0 700 190"
        className="w-full max-w-3xl"
        role="img"
        aria-label={`Evolução de ${group.name}, unidade ${group.unit ?? "não informada"}`}
      >
        <line x1="55" y1="155" x2="650" y2="155" stroke="currentColor" opacity="0.2" />
        <text x="5" y="35" fontSize="12">
          {maxValue}
        </text>
        <text x="5" y="153" fontSize="12">
          {minValue}
        </text>
        {segments.map((s) => {
          const from = byId.get(s.from)!,
            to = byId.get(s.to)!;
          return (
            <line
              key={s.from + s.to}
              x1={x(from.date)}
              y1={y(from.value)}
              x2={x(to.date)}
              y2={y(to.value)}
              stroke="var(--primary)"
              strokeWidth="2"
            />
          );
        })}
        {points.map((p) => (
          <circle key={p.id} cx={x(p.date)} cy={y(p.value)} r="4" fill="var(--primary)">
            <title>
              {p.entry.payload.collectedOn ? "Coleta" : "Resultado"} {labelDate(p.date)}:{" "}
              {p.entry.payload.result} {group.unit ?? ""}
            </title>
          </circle>
        ))}
        <text x="55" y="180" fontSize="11">
          {labelDate(points[0]!.date)}
        </text>
        <text x="650" y="180" textAnchor="end" fontSize="11">
          {labelDate(points[points.length - 1]!.date)}
        </text>
      </svg>
      <p className="text-xs text-muted-foreground">
        Valores literais; desigualdades, resultados qualitativos e datas repetidas interrompem a
        linha. Referências são específicas de cada resultado. Valores ambíguos ficam sem ponto
        numérico confiável. Linhas conectam apenas pontos com unidade, método, material e
        laboratório informados e idênticos; metadados incompletos permitem apenas pontos isolados.
      </p>
      <ul className="flex flex-wrap gap-3 text-xs">
        {points.map((p) => (
          <li key={p.id}>
            {p.entry.payload.collectedOn ? "Coleta" : "Resultado"} {labelDate(p.date)} ·{" "}
            {p.entry.payload.result} {group.unit ?? ""} ·{" "}
            <span>Ref.: {p.entry.payload.reference ?? "Não informada"}</span>
            <ReferenceStatus entry={p.entry} status={referenceStatuses.get(p.entry.id)} />
            <Source entry={p.entry} onOpenOriginal={onOpenOriginal} />
          </li>
        ))}
      </ul>
    </div>
  );
});
export type LaboratoryHistoryViewState = {
  dateFrom: string;
  dateTo: string;
  offset: number;
  search: string;
  groupLimit: number;
  dateOffset: number;
  expanded: string | null;
  scrollTop: number;
  scrollLeft: number;
  category?: string;
  collapsedCategories?: string[];
  dateOrder?: "asc" | "desc";
  selectedModalities?: Record<string, string>;
  expandedBiomarkers?: string[];
  idealDrafts?: Record<string, IdealTargetDraft>;
};
export function LaboratoryHistory({
  patientId,
  unitId,
  compact = false,
  onOpenOriginal,
  active = true,
  viewState,
}: {
  patientId: string;
  active?: boolean;
  viewState?: MutableRefObject<LaboratoryHistoryViewState | null>;
  unitId?: string | undefined;
  compact?: boolean;
  onOpenOriginal?: ((entry: LaboratoryHistoryEntry) => void) | undefined;
}) {
  const remembered = viewState?.current;
  const tableScroll = useRef<HTMLDivElement>(null);
  const position = useRef({ top: remembered?.scrollTop ?? 0, left: remembered?.scrollLeft ?? 0 });
  const [dateFrom, setDateFrom] = useState(remembered?.dateFrom ?? "");
  const [offset, setOffset] = useState(remembered?.offset ?? 0);
  const [dateTo, setDateTo] = useState(remembered?.dateTo ?? "");
  const invalidRange =
    (!!dateFrom && !laboratoryDate.safeParse(dateFrom).success) ||
    (!!dateTo && !laboratoryDate.safeParse(dateTo).success) ||
    (!!dateFrom && !!dateTo && dateFrom > dateTo);
  const resource =
    `laboratory-history?patientId=${encodeURIComponent(patientId)}` +
    (unitId !== undefined ? `&unitId=${encodeURIComponent(unitId)}` : "") +
    (dateFrom ? `&dateFrom=${dateFrom}` : "") +
    (dateTo ? `&dateTo=${dateTo}` : "") +
    (offset ? `&offset=${offset}` : "");
  const query = useInventory<Payload>(resource, { enabled: active && !invalidRange });
  const [search, setSearch] = useState(remembered?.search ?? "");
  const [category, setCategory] = useState(remembered?.category ?? "");
  const [collapsedCategories, setCollapsedCategories] = useState<string[]>(
    remembered?.collapsedCategories ?? [],
  );
  const [dateOrder, setDateOrder] = useState<"asc" | "desc">(remembered?.dateOrder ?? "asc");
  const [selectedModalities, setSelectedModalities] = useState<Record<string, string>>(
    remembered?.selectedModalities ?? {},
  );
  const [expandedBiomarkers, setExpandedBiomarkers] = useState<string[]>(
    remembered?.expandedBiomarkers ?? [],
  );
  const [idealDrafts, setIdealDrafts] = useState<Record<string, IdealTargetDraft>>(
    remembered?.idealDrafts ?? {},
  );
  const [editingIdeal, setEditingIdeal] = useState<{ biomarkerId: string; modeId: string } | null>(
    null,
  );
  const [selectedResultId, setSelectedResultId] = useState<string | null>(null);
  const selectedResult = query.data?.rows.find((entry) => entry.id === selectedResultId);
  const [groupLimit, setGroupLimit] = useState(remembered?.groupLimit ?? 50);
  const [dateOffset, setDateOffset] = useState(remembered?.dateOffset ?? 0);
  const [expanded, setExpanded] = useState<string | null>(remembered?.expanded ?? null);
  useEffect(() => {
    if (viewState)
      viewState.current = {
        dateFrom,
        dateTo,
        offset,
        search,
        category,
        collapsedCategories,
        dateOrder,
        selectedModalities,
        expandedBiomarkers,
        idealDrafts,
        groupLimit,
        dateOffset,
        expanded,
        scrollTop: position.current.top,
        scrollLeft: position.current.left,
      };
  }, [
    viewState,
    dateFrom,
    dateTo,
    offset,
    search,
    category,
    collapsedCategories,
    dateOrder,
    selectedModalities,
    expandedBiomarkers,
    idealDrafts,
    groupLimit,
    dateOffset,
    expanded,
  ]);
  useEffect(() => {
    if (tableScroll.current) {
      tableScroll.current.scrollTop = position.current.top;
      tableScroll.current.scrollLeft = position.current.left;
    }
  }, [query.data]);
  const projection = useMemo(
    () => projectLaboratoryObservations(query.data?.rows ?? []),
    [query.data],
  );
  const history = useMemo(() => buildLaboratoryHistory(projection.results), [projection]);
  const observationBlocks = (clinicalGroup: string | null) => {
    const observations = projection.observations.filter(
      ({ entry, group }) =>
        group === clinicalGroup &&
        (!category || group === category) &&
        (!search.trim() ||
          [entry.payload.result, entry.payload.name].some((text) =>
            text.toLocaleLowerCase("pt-BR").includes(search.trim().toLocaleLowerCase("pt-BR")),
          )),
    );
    if (!observations.length) return null;
    return (
      <section
        aria-label={
          clinicalGroup
            ? `Observações de ${clinicalGroup}`
            : "Observações documentais não classificadas"
        }
        className="space-y-2 px-3 py-3 text-xs text-slate-600"
      >
        <h4 className="font-medium text-slate-700">
          {clinicalGroup ? "Observações" : "Observações documentais não classificadas"}
        </h4>
        {observations.map(({ entry }) => (
          <div key={entry.id} className="flex flex-wrap items-start gap-x-3 gap-y-1">
            <span className="shrink-0 text-slate-500">
              {labelDate(laboratoryHistoryDate(entry) ?? "undated")}
            </span>
            <p className="min-w-0 flex-1 whitespace-pre-wrap">{entry.payload.result}</p>
            <button
              type="button"
              className="shrink-0 text-teal-700 hover:underline"
              onClick={() => setSelectedResultId(entry.id)}
              aria-label={`Ver observação de ${labelDate(laboratoryHistoryDate(entry) ?? "undated")}`}
            >
              Ver origem{entry.payload.sourcePage ? ` · p. ${entry.payload.sourcePage}` : ""}
            </button>
          </div>
        ))}
      </section>
    );
  };
  const biomarkers = useMemo(() => groupLaboratoryBiomarkers(history.groups), [history.groups]);
  const modesByBiomarker = useMemo(
    () => new Map(biomarkers.map((b) => [b.id, longitudinalModes(b)])),
    [biomarkers],
  );
  const selectModality = (biomarker: LaboratoryBiomarker, id: string) => {
    setSelectedModalities((current) => ({ ...current, [biomarker.id]: id }));
  };
  const idealKey = (biomarkerId: string, modeId: string) =>
    JSON.stringify([patientId, biomarkerId, modeId]);
  const editingBiomarker = biomarkers.find((b) => b.id === editingIdeal?.biomarkerId);
  const editingMode = editingBiomarker
    ? modesByBiomarker.get(editingBiomarker.id)?.find((m) => m.id === editingIdeal?.modeId)
    : undefined;
  const groups = useMemo(
    () =>
      biomarkers
        .filter(
          (g) =>
            (!category || laboratoryDisplayGroup(g.name) === category) &&
            [g.name, ...g.modalities.flatMap((m) => m.entries.map((e) => e.payload.name))].some(
              (name) =>
                name.toLocaleLowerCase("pt-BR").includes(search.trim().toLocaleLowerCase("pt-BR")),
            ),
        )
        .sort(
          (a, b) =>
            laboratoryDisplayGroups.indexOf(laboratoryDisplayGroup(a.name)) -
            laboratoryDisplayGroups.indexOf(laboratoryDisplayGroup(b.name)),
        ),
    [biomarkers, search, category],
  );
  const relevantDates = useMemo(() => {
    const dates = new Set(
      groups.flatMap((b) =>
        modesByBiomarker
          .get(b.id)!
          .flatMap((m) => m.entries.map((e) => laboratoryHistoryDate(e) ?? "undated")),
      ),
    );
    return history.dates.filter((date) => dates.has(date));
  }, [groups, history.dates, modesByBiomarker]);
  const endDate = Math.max(
    1,
    relevantDates.length - Math.min(dateOffset, Math.max(0, relevantDates.length - 1)),
  );
  const startDate = Math.max(0, endDate - 12);
  const visibleDates = relevantDates.slice(startDate, endDate);
  if (dateOrder === "desc") visibleDates.reverse();
  return (
    <section
      className={
        compact
          ? "min-w-0 overflow-x-clip space-y-3 [&_input]:h-8 [&_input]:text-xs [&_button]:text-xs"
          : "min-w-0 overflow-x-clip space-y-4"
      }
      aria-label="Histórico longitudinal de exames"
    >
      <div>
        <h3 className={compact ? "sr-only" : "font-semibold"}>
          {compact ? "Histórico de resultados" : "Resultados laboratoriais"}
        </h3>
        <p className={compact ? "text-xs text-muted-foreground" : "text-sm text-muted-foreground"}>
          Somente resultados confirmados. Clique em um valor para consultar a origem.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="sr-only" htmlFor={`laboratory-group-${patientId}`}>
          Grupo de exames
        </label>
        <select
          id={`laboratory-group-${patientId}`}
          aria-label="Grupo de exames"
          className="h-8 rounded-lg border px-2 text-xs"
          value={category}
          onChange={(event) => {
            setCategory(event.target.value);
            setGroupLimit(50);
          }}
        >
          <option value="">Todos os grupos</option>
          {laboratoryDisplayGroups.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
        <select
          aria-label="Ordenação das datas dos exames"
          className="h-8 rounded-lg border px-2 text-xs"
          value={dateOrder}
          onChange={(event) => setDateOrder(event.target.value as "asc" | "desc")}
        >
          <option value="asc">Datas crescentes</option>
          <option value="desc">Mais recentes primeiro</option>
        </select>
        <Input
          className="order-first min-w-44 max-w-xs flex-1"
          aria-label="Buscar parâmetro laboratorial"
          placeholder="Buscar exame…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setGroupLimit(50);
            setDateOffset(0);
          }}
        />
        <label className="space-y-1 text-xs">
          Data inicial
          <Input
            type="date"
            aria-label="Data inicial dos exames"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setOffset(0);
              setDateOffset(0);
            }}
          />
        </label>
        <label className="space-y-1 text-xs">
          Data final
          <Input
            type="date"
            aria-label="Data final dos exames"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setOffset(0);
              setDateOffset(0);
            }}
          />
        </label>
      </div>
      {invalidRange ? (
        <p role="alert" className="text-sm text-amber-900">
          Informe um período válido: a data inicial não pode superar a final.
        </p>
      ) : query.isPending || query.error ? (
        <InventoryState
          pending={query.isPending}
          error={query.error}
          retry={() => void query.refetch()}
        />
      ) : (
        <>
          {(!compact || query.data?.hasMore || offset > 0) && (
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span>
                Comparação limitada aos resultados desta página. Página{" "}
                {Math.floor(offset / 500) + 1}.
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={!query.data?.hasMore || offset >= 10000}
                onClick={() => {
                  setOffset((n) => Math.min(10000, n + 500));
                  setDateOffset(0);
                  setGroupLimit(50);
                  setExpanded(null);
                }}
              >
                Resultados anteriores
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={offset === 0}
                onClick={() => {
                  setOffset((n) => Math.max(0, n - 500));
                  setDateOffset(0);
                  setGroupLimit(50);
                  setExpanded(null);
                }}
              >
                Resultados mais recentes
              </Button>
            </div>
          )}
          {offset >= 10000 && query.data?.hasMore && (
            <p role="status" className="text-sm text-amber-900">
              Limite de páginas atingido. Selecione um período menor para consultar os demais
              resultados.
            </p>
          )}
          {query.data?.hasMore && (
            <p role="status" className="text-sm text-amber-900">
              Exibindo parte do histórico. Há resultados adicionais não incluídos nesta consulta.
            </p>
          )}
          {!!groups.length && (!compact || relevantDates.length > 12 || dateOffset > 0) && (
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span>
                {Math.min(groupLimit, groups.length)} de {groups.length} exames · Datas{" "}
                {startDate + 1}–{Math.min(endDate, relevantDates.length)} de {relevantDates.length}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={startDate === 0}
                onClick={() =>
                  setDateOffset(Math.min(Math.max(0, relevantDates.length - 1), dateOffset + 12))
                }
              >
                Datas anteriores
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={dateOffset === 0}
                onClick={() => setDateOffset(Math.max(0, dateOffset - 12))}
              >
                Datas mais recentes
              </Button>
            </div>
          )}
          {!history.groups.length ? (
            <p className="py-6 text-sm text-muted-foreground">
              {offset || dateFrom || dateTo
                ? "Nenhum resultado confirmado nesta página ou período."
                : "Nenhum resultado confirmado ainda. Confira um PDF para iniciar o histórico."}
            </p>
          ) : !groups.length ? (
            <p className="py-6 text-sm">Nenhum exame encontrado nesta busca.</p>
          ) : (
            <div
              ref={tableScroll}
              onScroll={(event) => {
                position.current = {
                  top: event.currentTarget.scrollTop,
                  left: event.currentTarget.scrollLeft,
                };
                if (viewState?.current) {
                  viewState.current.scrollTop = position.current.top;
                  viewState.current.scrollLeft = position.current.left;
                }
              }}
              className="max-h-[70vh] w-full min-w-0 max-w-full overflow-auto rounded-xl border"
            >
              <table
                className="w-full min-w-[760px] table-fixed text-left text-xs"
                aria-label="Tabela longitudinal de exames"
              >
                <thead className="sticky top-0 z-20 bg-white">
                  <tr className="h-11 border-b text-slate-600">
                    <th className="sticky left-0 z-30 w-44 bg-white px-3 font-medium">Exame</th>
                    <th className="w-20 px-3 font-medium">Unidade</th>
                    <th className="w-32 px-3 font-medium">Normal</th>
                    <th className="w-32 px-3 font-medium">Ideal</th>
                    {visibleDates.map((date) => (
                      <th className="w-28 px-3 font-medium" key={date}>
                        {labelDate(date)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {groups.slice(0, groupLimit).map((biomarker, groupIndex) => {
                    const modes = modesByBiomarker.get(biomarker.id)!;
                    const main =
                      modes.find((m) => m.id === selectedModalities[biomarker.id]) ?? modes[0]!;
                    const hidden = collapsedCategories.includes(
                      laboratoryDisplayGroup(biomarker.name),
                    );
                    const expandedModes = expandedBiomarkers.includes(biomarker.id);
                    const draft = idealDrafts[idealKey(biomarker.id, main.id)];
                    const byDate = new Map<string, LaboratoryHistoryEntry[]>();
                    for (const entry of main.entries) {
                      const key = laboratoryHistoryDate(entry) ?? "undated";
                      byDate.set(key, [...(byDate.get(key) ?? []), entry]);
                    }
                    const toggle = () =>
                      setExpandedBiomarkers((current) =>
                        current.includes(biomarker.id)
                          ? current.filter((id) => id !== biomarker.id)
                          : [...current, biomarker.id],
                      );
                    return (
                      <Fragment key={biomarker.id}>
                        {(groupIndex === 0 ||
                          laboratoryDisplayGroup(groups[groupIndex - 1]!.name) !==
                            laboratoryDisplayGroup(biomarker.name)) && (
                          <tr className="h-8 border-t bg-teal-50/60">
                            <th colSpan={visibleDates.length + 4} className="px-3 text-left">
                              <button
                                type="button"
                                className="text-xs font-medium text-teal-800"
                                aria-expanded={!hidden}
                                onClick={() =>
                                  setCollapsedCategories((current) =>
                                    hidden
                                      ? current.filter(
                                          (name) => name !== laboratoryDisplayGroup(biomarker.name),
                                        )
                                      : [...current, laboratoryDisplayGroup(biomarker.name)],
                                  )
                                }
                              >
                                {hidden ? "›" : "⌄"} {laboratoryDisplayGroup(biomarker.name)}
                              </button>
                            </th>
                          </tr>
                        )}
                        <tr
                          hidden={hidden}
                          data-main-row="true"
                          data-biomarker={biomarker.id}
                          data-modality={main.modality}
                          className="h-11 border-t hover:bg-slate-50/60"
                        >
                          <th scope="row" className="sticky left-0 z-10 bg-white px-3 font-medium">
                            <div className="flex min-w-0 items-center gap-1">
                              {modes.length > 1 && (
                                <button
                                  type="button"
                                  aria-label={`Modalidades de ${biomarker.name}`}
                                  aria-expanded={expandedModes}
                                  onClick={toggle}
                                  className="shrink-0 rounded px-1 text-teal-700"
                                >
                                  {expandedModes ? "⌄" : "›"}
                                </button>
                              )}
                              <button
                                type="button"
                                className="truncate text-left text-teal-800 hover:underline"
                                title={biomarker.name}
                                aria-expanded={expanded === biomarker.id}
                                onClick={() => {
                                  setExpanded(expanded === biomarker.id ? null : biomarker.id);
                                  if (modes.length > 1 && !expandedModes) toggle();
                                }}
                              >
                                {biomarker.name}
                              </button>
                            </div>
                          </th>
                          <td
                            className="truncate px-3"
                            title={main.unit ?? "Unidade não informada"}
                          >
                            {main.unit ?? "—"}
                          </td>
                          <td
                            className="truncate px-3 text-slate-600"
                            title={
                              main.modality === "UNRESOLVED"
                                ? "Referência não comparável: modalidade não resolvida"
                                : normalReference(main.entries)
                            }
                          >
                            {normalReference(main.entries)}
                          </td>
                          <td className="px-3">
                            <button
                              type="button"
                              aria-label={`Editar Ideal de ${biomarker.name}`}
                              className="max-w-full truncate rounded px-1 py-1 text-left text-teal-700 hover:bg-teal-50"
                              title={
                                draft
                                  ? "Rascunho não aplicado; persistência pendente"
                                  : "Definir meta ideal"
                              }
                              onClick={() =>
                                setEditingIdeal({ biomarkerId: biomarker.id, modeId: main.id })
                              }
                            >
                              {draft?.active
                                ? `${draft.minimum}–${draft.maximum} · rascunho`
                                : "Definir meta"}
                            </button>
                          </td>
                          {visibleDates.map((date) => (
                            <td key={date} className="px-3 py-2">
                              <div className="flex items-center gap-2 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                                {(byDate.get(date) ?? []).length === 0 && (
                                  <span className="text-slate-300">—</span>
                                )}
                                {(byDate.get(date) ?? []).map((entry) => {
                                  const status = laboratoryResultColor(entry, main, biomarker.id);
                                  return (
                                    <button
                                      key={entry.id}
                                      type="button"
                                      className="relative inline-flex shrink-0 items-center gap-1.5 rounded py-1 hover:underline focus-visible:outline-teal-700"
                                      aria-label={`Detalhes de ${biomarker.name}: ${entry.payload.result}`}
                                      title={status.explanation}
                                      onClick={() => setSelectedResultId(entry.id)}
                                    >
                                      <span
                                        aria-hidden="true"
                                        data-result-color={status.color}
                                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${status.color === "green" ? "bg-emerald-500" : status.color === "yellow" ? "bg-amber-400" : status.color === "red" ? "bg-red-500" : "bg-slate-300"}`}
                                      />
                                      <span>{entry.payload.result}</span>
                                      <span className="sr-only">{status.explanation}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            </td>
                          ))}
                        </tr>
                        {!hidden && expandedModes && modes.length > 1 && (
                          <tr className="bg-teal-50/20">
                            <td colSpan={visibleDates.length + 4} className="px-4 py-2">
                              <div
                                role="group"
                                aria-label={`Modalidade principal de ${biomarker.name}`}
                                className="flex flex-wrap items-center gap-1"
                              >
                                <span className="mr-2 font-medium">{biomarker.name}</span>
                                {modes.map((mode) => (
                                  <button
                                    type="button"
                                    aria-pressed={main.id === mode.id}
                                    key={mode.id}
                                    className={`rounded-md px-2.5 py-1 text-xs ${main.id === mode.id ? "bg-teal-100 text-teal-900" : "text-slate-600 hover:bg-slate-100"}`}
                                    onClick={() => selectModality(biomarker, mode.id)}
                                  >
                                    {mode.label}
                                  </button>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                        {!hidden && expanded === biomarker.id && (
                          <tr>
                            <td colSpan={visibleDates.length + 4}>
                              <div className="border-t bg-slate-50/30 p-2">
                                {main.modality === "UNRESOLVED" ? (
                                  <p className="p-3 text-xs text-muted-foreground">
                                    Modalidade não resolvida: gráfico indisponível até a conferência
                                    da unidade no original.
                                  </p>
                                ) : (
                                  <HistoryGraph
                                    group={{
                                      ...main.series[0]!,
                                      name: biomarker.name,
                                      entries: main.entries,
                                    }}
                                    compatibilityGroups={main.series}
                                    onOpenOriginal={onOpenOriginal}
                                  />
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                        {!hidden &&
                          (groupIndex === Math.min(groups.length, groupLimit) - 1 ||
                            laboratoryDisplayGroup(groups[groupIndex + 1]!.name) !==
                              laboratoryDisplayGroup(biomarker.name)) && (
                            <tr>
                              <td colSpan={visibleDates.length + 4}>
                                {observationBlocks(laboratoryDisplayGroup(biomarker.name))}
                              </td>
                            </tr>
                          )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {groups.length > groupLimit && (
            <Button variant="outline" onClick={() => setGroupLimit((n) => n + 50)}>
              Mostrar mais exames
            </Button>
          )}
        </>
      )}
      {laboratoryDisplayGroups
        .filter(
          (name) =>
            !groups.slice(0, groupLimit).some((b) => laboratoryDisplayGroup(b.name) === name) &&
            !collapsedCategories.includes(name),
        )
        .map((name) => (
          <Fragment key={name}>{observationBlocks(name)}</Fragment>
        ))}
      {observationBlocks(null)}
      <Dialog
        open={Boolean(selectedResult)}
        onOpenChange={(open) => {
          if (!open) setSelectedResultId(null);
        }}
      >
        <DialogContent className="clinical-workspace sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {selectedResult && isLaboratoryObservation(selectedResult)
                ? "Observação laboratorial"
                : "Resultado confirmado"}
            </DialogTitle>
            <DialogDescription>
              Dados do laboratório e origem preservada, sem interpretação automática.
            </DialogDescription>
          </DialogHeader>
          {selectedResult && (
            <div className="space-y-3 text-sm">
              <p className="text-lg font-semibold">
                {selectedResult.payload.name} · {selectedResult.payload.result}{" "}
                {selectedResult.payload.unit ?? ""}
              </p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
                <dt>Nome original</dt>
                <dd>{selectedResult.payload.name}</dd>
                <dt>Unidade de origem</dt>
                <dd>{selectedResult.payload.unit ?? "Não informada"}</dd>
                <dt>Meta ideal</dt>
                <dd>Sem meta ideal persistida aplicável. Rascunhos não são utilizados.</dd>
                <dt>Página de origem</dt>
                <dd>{selectedResult.payload.sourcePage ?? "Não informada"}</dd>
                <dt>Data</dt>
                <dd>{labelDate(laboratoryHistoryDate(selectedResult) ?? "undated")}</dd>
                <dt>Referência</dt>
                <dd>{selectedResult.payload.reference ?? "Não informada"}</dd>
                <dt>Laboratório</dt>
                <dd title={selectedResult.payload.laboratory ?? undefined}>
                  {selectedResult.payload.laboratory
                    ? laboratoryProvenanceLabel(selectedResult.payload.laboratory)
                    : "Não informado"}
                </dd>
                <dt>Método</dt>
                <dd>{selectedResult.payload.method ?? "Não informado"}</dd>
                <dt>Material</dt>
                <dd>{selectedResult.payload.material ?? "Não informado"}</dd>
              </dl>
              {laboratoryScaleReview(selectedResult).needsReview && (
                <p className="text-xs text-amber-800" role="status">
                  {laboratoryScaleReview(selectedResult).reason}
                </p>
              )}
              <ReferenceStatus
                entry={selectedResult}
                status={
                  biomarkers
                    .flatMap((b) => b.modalities)
                    .find((m) => m.entries.some((e) => e.id === selectedResult.id))?.modality ===
                  "UNRESOLVED"
                    ? "unknown"
                    : applicableLaboratoryReference(selectedResult)
                }
              />
              <Source
                entry={selectedResult}
                onOpenOriginal={
                  onOpenOriginal
                    ? (entry) => {
                        setSelectedResultId(null);
                        onOpenOriginal(entry);
                      }
                    : undefined
                }
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
      {editingBiomarker && editingMode && (
        <LaboratoryIdealEditor
          key={idealKey(editingBiomarker.id, editingMode.id)}
          biomarker={editingBiomarker.id}
          name={editingBiomarker.name}
          modality={editingMode.modality}
          unit={editingMode.unit}
          draft={idealDrafts[idealKey(editingBiomarker.id, editingMode.id)]}
          onDraft={(draft) =>
            setIdealDrafts((current) => ({
              ...current,
              [idealKey(editingBiomarker.id, editingMode.id)]: draft,
            }))
          }
          onClose={() => setEditingIdeal(null)}
        />
      )}
    </section>
  );
}
