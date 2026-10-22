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
  laboratoryHistorySeries,
  laboratoryHistoryReference,
  type LaboratoryHistoryEntry,
  type LaboratoryHistoryGroup,
} from "@/lib/laboratory-history";
import {
  groupLaboratoryBiomarkers,
  laboratoryModalityLabel,
  type LaboratoryBiomarker,
} from "@/lib/laboratory-biomarkers";
import { laboratoryDate } from "@/lib/laboratory-results";
import { InventoryState } from "./inventory-state";

type Payload = { rows: LaboratoryHistoryEntry[]; hasMore: boolean; offset: number };
const labelDate = (date: string) =>
  date === "undated" ? "Sem data de exame" : date.split("-").reverse().join("/");
function ReferenceStatus({
  entry,
  status = laboratoryHistoryReference(entry),
}: {
  entry: LaboratoryHistoryEntry;
  status?: ReturnType<typeof laboratoryHistoryReference> | undefined;
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
          ? "text-xs text-sky-800"
          : status === "high"
            ? "text-xs text-amber-800"
            : status === "within"
              ? "text-xs text-teal-800"
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
      href={withSelectedUnit(entry.previewUrl)}
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
}: {
  group: LaboratoryHistoryGroup;
  onOpenOriginal?: ((entry: LaboratoryHistoryEntry) => void) | undefined;
}) {
  const { points, segments } = useMemo(() => laboratoryHistorySeries(group), [group]);
  const referenceStatuses = useMemo(
    () => new Map(group.entries.map((entry) => [entry.id, laboratoryHistoryReference(entry)])),
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
  const history = useMemo(() => buildLaboratoryHistory(query.data?.rows ?? []), [query.data]);
  const biomarkers = useMemo(() => groupLaboratoryBiomarkers(history.groups), [history.groups]);
  const selectModality = (biomarker: LaboratoryBiomarker, id: string) => {
    setSelectedModalities((current) => ({ ...current, [biomarker.id]: id }));
    setExpanded((current) =>
      biomarker.modalities.some((mode) => mode.id === current) ? id : current,
    );
  };
  const indexed = useMemo(
    () =>
      new Map(
        biomarkers
          .flatMap((b) => b.modalities)
          .map((group) => {
            const byDate = new Map<string, LaboratoryHistoryEntry[]>();
            const referenceStatuses = new Map<
              string,
              ReturnType<typeof laboratoryHistoryReference>
            >();
            const references = new Set<string>();
            for (const entry of group.entries) {
              const date = laboratoryHistoryDate(entry) ?? "undated";
              const bucket = byDate.get(date) ?? [];
              bucket.push(entry);
              byDate.set(date, bucket);
              references.add(entry.payload.reference ?? "Não informada");
              referenceStatuses.set(
                entry.id,
                group.modality === "UNRESOLVED" ? "unknown" : laboratoryHistoryReference(entry),
              );
            }
            return [
              group.id,
              { byDate, references: [...references].join(" · "), referenceStatuses },
            ] as const;
          }),
      ),
    [biomarkers],
  );
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
        b.modalities.flatMap((group) => [...indexed.get(group.id)!.byDate.keys()]),
      ),
    );
    return history.dates.filter((date) => dates.has(date));
  }, [groups, history.dates, indexed]);
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
          ? "min-w-0 space-y-3 [&_input]:h-8 [&_input]:text-xs [&_button]:text-xs"
          : "min-w-0 space-y-4"
      }
      aria-label="Histórico longitudinal de exames"
    >
      <div>
        <h3 className={compact ? "sr-only" : "font-semibold"}>
          {compact ? "Histórico de resultados" : "Resultados laboratoriais"}
        </h3>
        <p className={compact ? "text-xs text-muted-foreground" : "text-sm text-muted-foreground"}>
          Somente resultados confirmados. Unidades, métodos, material e laboratórios diferentes
          permanecem separados.
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
              className="max-h-[70vh] overflow-auto rounded-xl border"
            >
              <table
                className={
                  compact
                    ? "w-full min-w-[720px] text-left text-xs [&_td]:p-2.5 [&_th]:p-2.5"
                    : "w-full min-w-[800px] text-left text-sm"
                }
                aria-label="Tabela longitudinal de exames"
              >
                <thead className="sticky top-0 z-20 bg-white">
                  <tr>
                    <th
                      className={
                        compact
                          ? "sticky left-0 z-30 w-40 min-w-40 max-w-40 bg-white p-3"
                          : "sticky left-0 z-30 w-56 min-w-56 max-w-56 bg-white p-3"
                      }
                    >
                      Exame
                    </th>
                    <th
                      className={
                        compact
                          ? "md:sticky md:left-40 z-30 w-20 min-w-20 max-w-20 bg-white p-3"
                          : "md:sticky md:left-56 z-30 w-28 min-w-28 max-w-28 bg-white p-3"
                      }
                    >
                      Unidade
                    </th>
                    <th
                      className={
                        compact
                          ? "md:sticky md:left-60 z-30 w-32 min-w-32 max-w-32 bg-white p-3"
                          : "md:sticky md:left-[21rem] z-30 w-48 min-w-48 max-w-48 bg-white p-3"
                      }
                    >
                      Normal (laboratório)
                    </th>
                    <th className="min-w-32 bg-white p-3">Ideal</th>
                    {visibleDates.map((date) => (
                      <th className={compact ? "min-w-28 p-3" : "min-w-44 p-3"} key={date}>
                        {labelDate(date)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {groups.slice(0, groupLimit).flatMap((biomarker, groupIndex) => {
                    const main =
                      biomarker.modalities.find((m) => m.id === selectedModalities[biomarker.id]) ??
                      biomarker.modalities[0]!;
                    const modes = expandedBiomarkers.includes(biomarker.id)
                      ? [main, ...biomarker.modalities.filter((m) => m.id !== main.id)]
                      : [main];
                    return modes.map((group, modalityIndex) => (
                      <Fragment key={modalityIndex === 0 ? `${biomarker.id}:main` : group.id}>
                        {modalityIndex === 0 &&
                          (groupIndex === 0 ||
                            laboratoryDisplayGroup(groups[groupIndex - 1]!.name) !==
                              laboratoryDisplayGroup(group.name)) && (
                            <tr className="border-t bg-teal-50/60">
                              <th colSpan={visibleDates.length + 4} className="p-2 text-left">
                                <button
                                  type="button"
                                  className="flex items-center gap-2 text-xs font-semibold text-teal-800"
                                  aria-expanded={
                                    !collapsedCategories.includes(
                                      laboratoryDisplayGroup(group.name),
                                    )
                                  }
                                  onClick={() =>
                                    setCollapsedCategories((previous) =>
                                      previous.includes(laboratoryDisplayGroup(group.name))
                                        ? previous.filter(
                                            (name) => name !== laboratoryDisplayGroup(group.name),
                                          )
                                        : [...previous, laboratoryDisplayGroup(group.name)],
                                    )
                                  }
                                >
                                  {collapsedCategories.includes(laboratoryDisplayGroup(group.name))
                                    ? "›"
                                    : "⌄"}{" "}
                                  {laboratoryDisplayGroup(group.name)}
                                </button>
                              </th>
                            </tr>
                          )}
                        <tr
                          hidden={collapsedCategories.includes(laboratoryDisplayGroup(group.name))}
                          data-biomarker={biomarker.id}
                          data-modality={group.modality}
                          data-main-row={modalityIndex === 0}
                          className={
                            modalityIndex === 0
                              ? "border-t align-top"
                              : "border-t align-top bg-slate-50/50"
                          }
                        >
                          <th
                            scope="row"
                            className={
                              compact
                                ? "sticky left-0 z-10 w-40 min-w-40 max-w-40 bg-white p-3"
                                : "sticky left-0 z-10 w-56 min-w-56 max-w-56 bg-white p-3"
                            }
                          >
                            {modalityIndex === 0 && biomarker.modalities.length > 1 && (
                              <button
                                type="button"
                                className="mr-2 rounded px-1 text-teal-700"
                                aria-label={`Modalidades de ${biomarker.name}`}
                                aria-expanded={expandedBiomarkers.includes(biomarker.id)}
                                onClick={() =>
                                  setExpandedBiomarkers((current) =>
                                    current.includes(biomarker.id)
                                      ? current.filter((id) => id !== biomarker.id)
                                      : [...current, biomarker.id],
                                  )
                                }
                              >
                                {expandedBiomarkers.includes(biomarker.id) ? "⌄" : "›"}
                              </button>
                            )}
                            <Button
                              className="h-auto whitespace-normal p-0 text-left"
                              variant="link"
                              aria-expanded={expanded === group.id}
                              onClick={() => {
                                if (modalityIndex > 0) selectModality(biomarker, group.id);
                                setExpanded(expanded === group.id ? null : group.id);
                              }}
                            >
                              {modalityIndex === 0
                                ? biomarker.name
                                : laboratoryModalityLabel(group, biomarker.modalities)}
                            </Button>
                            {modalityIndex === 0 && biomarker.modalities.length > 1 && (
                              <select
                                aria-label={`Modalidade principal de ${biomarker.name}`}
                                className="mt-1 w-full rounded border bg-white px-1 py-1 text-xs font-normal"
                                value={main.id}
                                onChange={(event) => selectModality(biomarker, event.target.value)}
                              >
                                {biomarker.modalities.map((mode) => (
                                  <option key={mode.id} value={mode.id}>
                                    {laboratoryModalityLabel(mode, biomarker.modalities)}
                                  </option>
                                ))}
                              </select>
                            )}
                            {group.modality === "UNRESOLVED" && (
                              <p className="text-xs font-normal text-amber-800">
                                Modalidade não resolvida
                              </p>
                            )}
                            {modalityIndex > 0 && (
                              <button
                                type="button"
                                className="block text-xs font-normal text-teal-700 underline"
                                onClick={() => selectModality(biomarker, group.id)}
                              >
                                Usar como principal
                              </button>
                            )}
                            <p
                              title={`${group.method ?? "Método não informado"} · ${group.material ?? "Material não informado"} · ${group.laboratory ?? "Laboratório não informado"}`}
                              className={
                                compact
                                  ? "mt-1 truncate text-[10px] font-normal text-muted-foreground"
                                  : "mt-1 truncate text-xs font-normal text-muted-foreground"
                              }
                            >
                              {group.method ?? "Método não informado: comparação limitada"}
                              {group.material
                                ? ` · ${group.material}`
                                : " · Material não informado: comparação limitada"}
                              {group.laboratory
                                ? ` · ${group.laboratory}`
                                : " · Laboratório não informado: comparação limitada"}
                            </p>
                          </th>
                          <td
                            className={
                              compact
                                ? "md:sticky md:left-40 z-10 w-20 min-w-20 max-w-20 bg-white p-3"
                                : "md:sticky md:left-56 z-10 w-28 min-w-28 max-w-28 bg-white p-3"
                            }
                          >
                            {group.unit ?? "Não informada"}
                          </td>
                          <td
                            className={
                              compact
                                ? "md:sticky md:left-60 z-10 w-32 min-w-32 max-w-32 bg-white p-3 text-[10px]"
                                : "md:sticky md:left-[21rem] z-10 w-48 min-w-48 max-w-48 bg-white p-3 text-xs"
                            }
                          >
                            {group.modality === "UNRESOLVED" ? "Referência não comparável · " : ""}
                            {indexed.get(group.id)!.references}
                            {!compact && (
                              <p className="mt-1 text-muted-foreground">
                                Confira a referência em cada resultado.
                              </p>
                            )}
                          </td>
                          <td className="p-3 text-xs text-muted-foreground">Sem meta definida</td>
                          {visibleDates.map((date) => (
                            <td key={date} className="p-3">
                              {(indexed.get(group.id)!.byDate.get(date) ?? []).map((entry) => (
                                <div
                                  className={
                                    compact
                                      ? "mb-2 flex items-center gap-3 last:mb-0"
                                      : "mb-3 space-y-1 last:mb-0"
                                  }
                                  key={entry.id}
                                >
                                  {compact ? (
                                    <div
                                      className="flex items-center gap-1.5"
                                      title={`${entry.payload.collectedOn ? "Coleta" : entry.payload.reportedOn ? "Resultado" : "Sem data"} · Ref.: ${entry.payload.reference ?? "Não informada"}`}
                                    >
                                      <span
                                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${indexed.get(group.id)!.referenceStatuses.get(entry.id) === "within" ? "bg-emerald-600" : indexed.get(group.id)!.referenceStatuses.get(entry.id) === "unknown" ? "bg-slate-300" : indexed.get(group.id)!.referenceStatuses.get(entry.id) === "low" ? "bg-sky-500" : "bg-amber-500"}`}
                                      />
                                      <button
                                        type="button"
                                        className="font-medium underline-offset-2 hover:underline focus-visible:outline-teal-700"
                                        aria-label={`Detalhes de ${group.name}: ${entry.payload.result}`}
                                        onClick={() => setSelectedResultId(entry.id)}
                                      >
                                        {entry.payload.result}
                                      </button>
                                      <div className="sr-only">
                                        <ReferenceStatus
                                          entry={entry}
                                          status={indexed
                                            .get(group.id)!
                                            .referenceStatuses.get(entry.id)}
                                        />{" "}
                                        Ref.: {entry.payload.reference ?? "Não informada"}
                                      </div>
                                    </div>
                                  ) : (
                                    <>
                                      <button
                                        type="button"
                                        className="font-medium underline-offset-2 hover:underline"
                                        aria-label={`Detalhes de ${group.name}: ${entry.payload.result}`}
                                        onClick={() => setSelectedResultId(entry.id)}
                                      >
                                        {entry.payload.result}
                                      </button>
                                      <p className="text-xs text-muted-foreground">
                                        {entry.payload.collectedOn
                                          ? "Data de coleta"
                                          : entry.payload.reportedOn
                                            ? "Data do resultado"
                                            : "Data não informada"}
                                      </p>
                                      <ReferenceStatus
                                        entry={entry}
                                        status={indexed
                                          .get(group.id)!
                                          .referenceStatuses.get(entry.id)}
                                      />
                                      <p className="text-xs text-muted-foreground">
                                        Ref.: {entry.payload.reference ?? "Não informada"}
                                      </p>
                                    </>
                                  )}
                                  <Source
                                    entry={entry}
                                    compact={compact}
                                    onOpenOriginal={onOpenOriginal}
                                  />
                                </div>
                              ))}
                            </td>
                          ))}
                        </tr>
                        {expanded === group.id &&
                          !collapsedCategories.includes(laboratoryDisplayGroup(group.name)) && (
                            <tr>
                              <td colSpan={visibleDates.length + 4}>
                                {biomarker.modalities.length > 1 && (
                                  <label className="block px-3 pt-3 text-xs">
                                    Modalidade do gráfico
                                    <select
                                      aria-label={`Modalidade do gráfico de ${biomarker.name}`}
                                      className="ml-2 rounded border p-1"
                                      value={group.id}
                                      onChange={(event) => {
                                        selectModality(biomarker, event.target.value);
                                        setExpanded(event.target.value);
                                      }}
                                    >
                                      {biomarker.modalities.map((mode) => (
                                        <option key={mode.id} value={mode.id}>
                                          {laboratoryModalityLabel(mode, biomarker.modalities)}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                )}
                                {group.modality === "UNRESOLVED" ? (
                                  <p className="p-3 text-sm text-muted-foreground">
                                    Modalidade não resolvida: gráfico indisponível até a conferência
                                    da unidade e modalidade no original.
                                  </p>
                                ) : (
                                  <HistoryGraph group={group} onOpenOriginal={onOpenOriginal} />
                                )}
                              </td>
                            </tr>
                          )}
                      </Fragment>
                    ));
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
      <Dialog
        open={Boolean(selectedResult)}
        onOpenChange={(open) => {
          if (!open) setSelectedResultId(null);
        }}
      >
        <DialogContent className="clinical-workspace sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Resultado confirmado</DialogTitle>
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
                <dt>Data</dt>
                <dd>{labelDate(laboratoryHistoryDate(selectedResult) ?? "undated")}</dd>
                <dt>Referência</dt>
                <dd>{selectedResult.payload.reference ?? "Não informada"}</dd>
                <dt>Laboratório</dt>
                <dd>{selectedResult.payload.laboratory ?? "Não informado"}</dd>
                <dt>Método</dt>
                <dd>{selectedResult.payload.method ?? "Não informado"}</dd>
                <dt>Material</dt>
                <dd>{selectedResult.payload.material ?? "Não informado"}</dd>
              </dl>
              <ReferenceStatus
                entry={selectedResult}
                status={
                  biomarkers
                    .flatMap((b) => b.modalities)
                    .find((m) => m.entries.some((e) => e.id === selectedResult.id))?.modality ===
                  "UNRESOLVED"
                    ? "unknown"
                    : laboratoryHistoryReference(selectedResult)
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
    </section>
  );
}
