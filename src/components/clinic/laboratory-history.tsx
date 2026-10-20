import { Fragment, memo, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { ArrowDownUp, ChevronDown, ChevronRight, Search, SlidersHorizontal } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import "./clinical-exams-workspace.css";
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
import { laboratoryDate } from "@/lib/laboratory-results";
import { InventoryState } from "./inventory-state";

type Payload = { rows: LaboratoryHistoryEntry[]; hasMore: boolean; offset: number };
// Navigation categories only: this does not normalize results, infer diagnoses or join series.
function navigationCategory(name: string) {
  const value = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
  if (/\b(tsh|t3|t4|tireo|tiro|anti.?tpo|anti.?tireoglobulina)\b/.test(value)) return "Tireoide";
  if (/glic|insulina|hemoglobina glicada|hba1c|homa/.test(value)) return "Metabolismo glicídico";
  if (/colesterol|triglicer|hdl|ldl|lipid|apolipoproteina/.test(value)) return "Perfil lipídico";
  if (/cortisol|dhea|adrenal/.test(value)) return "Adrenal";
  if (/vitamina|mineral|ferritina|ferro|zinco|magnesio|calcio/.test(value))
    return "Vitaminas e minerais";
  return "Outros exames";
}
const categoryOrder = [
  "Tireoide",
  "Metabolismo glicídico",
  "Perfil lipídico",
  "Adrenal",
  "Vitaminas e minerais",
  "Outros exames",
];
const referenceLabels = {
  low: "Abaixo da referência",
  within: "Dentro da referência",
  high: "Acima da referência",
  unknown: "Sem referência comparável",
};
const referenceDots = {
  low: "bg-sky-600",
  within: "bg-emerald-600",
  high: "bg-amber-500",
  unknown: "bg-slate-400",
};
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
        status === "low" || status === "high"
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
  chronological?: "oldest" | "newest";
  collapsedCategories?: string[];
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
  const [groupLimit, setGroupLimit] = useState(remembered?.groupLimit ?? 50);
  const [dateOffset, setDateOffset] = useState(remembered?.dateOffset ?? 0);
  const [expanded, setExpanded] = useState<string | null>(remembered?.expanded ?? null);
  const [category, setCategory] = useState(remembered?.category ?? "all");
  const [chronological, setChronological] = useState<"oldest" | "newest">(
    remembered?.chronological ?? "oldest",
  );
  const [collapsedCategories, setCollapsedCategories] = useState<string[]>(
    remembered?.collapsedCategories ?? [],
  );
  const detailScope = `${patientId}:${unitId ?? ""}`;
  const [selectedResult, setSelectedResult] = useState<{
    scope: string;
    entry: LaboratoryHistoryEntry;
  } | null>(null);
  const detail = selectedResult?.scope === detailScope ? selectedResult.entry : null;
  function setDetail(entry: LaboratoryHistoryEntry | null) {
    setSelectedResult(entry ? { scope: detailScope, entry } : null);
  }
  useEffect(() => {
    if (viewState)
      viewState.current = {
        dateFrom,
        dateTo,
        offset,
        search,
        groupLimit,
        dateOffset,
        expanded,
        category,
        chronological,
        collapsedCategories,
        scrollTop: position.current.top,
        scrollLeft: position.current.left,
      };
  }, [
    viewState,
    dateFrom,
    dateTo,
    offset,
    search,
    groupLimit,
    dateOffset,
    expanded,
    category,
    chronological,
    collapsedCategories,
  ]);
  useEffect(() => {
    if (tableScroll.current) {
      tableScroll.current.scrollTop = position.current.top;
      tableScroll.current.scrollLeft = position.current.left;
    }
  }, [query.data]);
  const history = useMemo(() => buildLaboratoryHistory(query.data?.rows ?? []), [query.data]);
  const indexed = useMemo(
    () =>
      new Map(
        history.groups.map((group) => {
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
            referenceStatuses.set(entry.id, laboratoryHistoryReference(entry));
          }
          return [
            group.id,
            { byDate, references: [...references].join(" · "), referenceStatuses },
          ] as const;
        }),
      ),
    [history.groups],
  );
  const groups = useMemo(
    () =>
      history.groups.filter(
        (g) =>
          (category === "all" || navigationCategory(g.name) === category) &&
          g.name.toLocaleLowerCase("pt-BR").includes(search.trim().toLocaleLowerCase("pt-BR")),
      ),
    [history.groups, search, category],
  );
  const relevantDates = useMemo(() => {
    const dates = new Set(groups.flatMap((group) => [...indexed.get(group.id)!.byDate.keys()]));
    return history.dates.filter((date) => dates.has(date));
  }, [groups, history.dates, indexed]);
  const endDate = Math.max(
    1,
    relevantDates.length - Math.min(dateOffset, Math.max(0, relevantDates.length - 1)),
  );
  const startDate = Math.max(0, endDate - 12);
  const windowDates = relevantDates.slice(startDate, endDate);
  const datedColumns = windowDates.filter((date) => date !== "undated");
  const visibleDates = [
    ...(chronological === "oldest" ? datedColumns : [...datedColumns].reverse()),
    ...(windowDates.includes("undated") ? ["undated"] : []),
  ];
  const navigationCategories = categoryOrder.filter((name) =>
    history.groups.some((group) => navigationCategory(group.name) === name),
  );
  const visibleGroups = useMemo(
    () =>
      categoryOrder.flatMap((name) =>
        groups.slice(0, groupLimit).filter((group) => navigationCategory(group.name) === name),
      ),
    [groups, groupLimit],
  );
  return (
    <section
      className={
        compact
          ? "min-w-0 space-y-3 [&_input]:h-8 [&_input]:text-xs [&_button]:text-xs"
          : "min-w-0 space-y-4"
      }
      aria-label="Histórico longitudinal de exames"
    >
      <div className="clinical-lab-toolbar">
        <h3 className={compact ? "sr-only" : "font-semibold"}>Resultados laboratoriais</h3>
        <label className="clinical-lab-search">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <Input
            aria-label="Buscar parâmetro laboratorial"
            placeholder="Buscar parâmetro…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setGroupLimit(50);
              setDateOffset(0);
            }}
          />
        </label>
        <label className="sr-only" htmlFor={`lab-category-${patientId}`}>
          Grupo de exames
        </label>
        <select
          id={`lab-category-${patientId}`}
          className="clinical-lab-select"
          value={category}
          onChange={(event) => {
            setCategory(event.target.value);
            setDateOffset(0);
          }}
        >
          <option value="all">Todos os grupos</option>
          {navigationCategories.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <details className="clinical-lab-period">
          <summary className="flex h-9 cursor-pointer list-none items-center gap-2 rounded-lg border px-3 text-xs">
            <SlidersHorizontal className="size-3.5" />
            {dateFrom || dateTo ? "Período selecionado" : "Todo o período"}
            <ChevronDown className="size-3" />
          </summary>
          <div className="clinical-lab-period-fields">
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
            {(dateFrom || dateTo) && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDateFrom("");
                  setDateTo("");
                  setOffset(0);
                  setDateOffset(0);
                }}
              >
                Limpar período
              </Button>
            )}
          </div>
        </details>
        <label className="flex items-center gap-1.5 text-muted-foreground">
          <ArrowDownUp className="size-3.5" />
          <select
            className="clinical-lab-select"
            aria-label="Ordenação temporal dos exames"
            value={chronological}
            onChange={(event) => setChronological(event.target.value as "oldest" | "newest")}
          >
            <option value="oldest">Mais antigos primeiro</option>
            <option value="newest">Mais recentes primeiro</option>
          </select>
        </label>
      </div>
      <div className="clinical-lab-caption">
        <p>
          Somente resultados confirmados. Unidades, métodos, material e laboratórios diferentes
          permanecem separados.
        </p>
        <div className="flex flex-wrap gap-3">
          {Object.entries(referenceLabels).map(([status, label]) => (
            <span key={status} className="inline-flex items-center gap-1.5">
              <span
                className={`size-1.5 rounded-full ${referenceDots[status as keyof typeof referenceDots]}`}
              />
              {label}
            </span>
          ))}
        </div>
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
              className="clinical-lab-table-scroll max-h-[70vh] overflow-auto rounded-xl border"
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
                      Referência do laboratório
                    </th>
                    {visibleDates.map((date) => (
                      <th className={compact ? "min-w-28 p-3" : "min-w-44 p-3"} key={date}>
                        {labelDate(date)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleGroups.map((group, index) => (
                    <Fragment key={group.id}>
                      {(index === 0 ||
                        navigationCategory(visibleGroups[index - 1]!.name) !==
                          navigationCategory(group.name)) && (
                        <tr className="clinical-lab-category">
                          <td colSpan={visibleDates.length + 3}>
                            <button
                              type="button"
                              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs font-semibold"
                              aria-expanded={
                                !collapsedCategories.includes(navigationCategory(group.name))
                              }
                              aria-label={`Grupo ${navigationCategory(group.name)}`}
                              onClick={() => {
                                const name = navigationCategory(group.name);
                                setCollapsedCategories((current) =>
                                  current.includes(name)
                                    ? current.filter((value) => value !== name)
                                    : [...current, name],
                                );
                              }}
                            >
                              {collapsedCategories.includes(navigationCategory(group.name)) ? (
                                <ChevronRight className="size-3.5" />
                              ) : (
                                <ChevronDown className="size-3.5" />
                              )}
                              {navigationCategory(group.name)}
                              <span className="ml-auto text-[10px] font-normal">
                                {
                                  groups.filter(
                                    (entry) =>
                                      navigationCategory(entry.name) ===
                                      navigationCategory(group.name),
                                  ).length
                                }{" "}
                                {groups.filter(
                                  (entry) =>
                                    navigationCategory(entry.name) ===
                                    navigationCategory(group.name),
                                ).length === 1
                                  ? "parâmetro"
                                  : "parâmetros"}
                              </span>
                            </button>
                          </td>
                        </tr>
                      )}
                      <tr
                        className="border-t align-top"
                        hidden={collapsedCategories.includes(navigationCategory(group.name))}
                      >
                        <th
                          scope="row"
                          className={
                            compact
                              ? "sticky left-0 z-10 w-40 min-w-40 max-w-40 bg-white p-3"
                              : "sticky left-0 z-10 w-56 min-w-56 max-w-56 bg-white p-3"
                          }
                        >
                          <Button
                            className="h-auto whitespace-normal p-0 text-left"
                            variant="link"
                            aria-expanded={expanded === group.id}
                            onClick={() => setExpanded(expanded === group.id ? null : group.id)}
                          >
                            {group.name}
                          </Button>
                          <p
                            title={`${group.method ?? "Método não informado"} · ${group.material ?? "Material não informado"} · ${group.laboratory ?? "Laboratório não informado"}`}
                            className={
                              compact
                                ? "mt-1 truncate text-[10px] font-normal text-muted-foreground"
                                : "mt-1 text-xs font-normal text-muted-foreground"
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
                          {indexed.get(group.id)!.references}
                          {!compact && (
                            <p className="mt-1 text-muted-foreground">
                              Confira a referência em cada resultado.
                            </p>
                          )}
                        </td>
                        {visibleDates.map((date) => (
                          <td key={date} className="p-3">
                            {(indexed.get(group.id)!.byDate.get(date) ?? []).map((entry) => (
                              <div className="mb-3 space-y-1 last:mb-0" key={entry.id}>
                                {compact ? (
                                  <button
                                    type="button"
                                    className="clinical-lab-result flex items-center gap-1.5"
                                    aria-label={`Detalhes de ${group.name}: ${entry.payload.result}, ${labelDate(date)}`}
                                    onClick={() => setDetail(entry)}
                                    title={`${entry.payload.collectedOn ? "Coleta" : entry.payload.reportedOn ? "Resultado" : "Sem data"} · Ref.: ${entry.payload.reference ?? "Não informada"}`}
                                  >
                                    <span
                                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${referenceDots[indexed.get(group.id)!.referenceStatuses.get(entry.id) ?? "unknown"]}`}
                                    />
                                    <span className="font-medium">{entry.payload.result}</span>
                                    <div className="sr-only">
                                      <ReferenceStatus
                                        entry={entry}
                                        status={indexed
                                          .get(group.id)!
                                          .referenceStatuses.get(entry.id)}
                                      />{" "}
                                      Ref.: {entry.payload.reference ?? "Não informada"}
                                    </div>
                                  </button>
                                ) : (
                                  <>
                                    <p className="font-medium">{entry.payload.result}</p>
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
                        !collapsedCategories.includes(navigationCategory(group.name)) && (
                          <tr>
                            <td colSpan={visibleDates.length + 3}>
                              <HistoryGraph group={group} onOpenOriginal={onOpenOriginal} />
                            </td>
                          </tr>
                        )}
                    </Fragment>
                  ))}
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
        open={detail !== null}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
      >
        <DialogContent className="clinical-workspace sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{detail?.payload.name ?? "Resultado laboratorial"}</DialogTitle>
            <DialogDescription>
              Resultado confirmado. A referência pertence ao documento de origem.
            </DialogDescription>
          </DialogHeader>
          {detail && (
            <>
              <div className="rounded-xl border bg-slate-50 p-4">
                <p className="mb-1 text-xs text-muted-foreground">
                  {detail.payload.collectedOn ? "Data de coleta" : "Data do resultado"} ·{" "}
                  {labelDate(laboratoryHistoryDate(detail) ?? "undated")}
                </p>
                <p className="text-2xl font-semibold tracking-tight">
                  {detail.payload.result}{" "}
                  <span className="text-sm font-normal text-muted-foreground">
                    {detail.payload.unit ?? "Unidade não informada"}
                  </span>
                </p>
                <ReferenceStatus entry={detail} />
              </div>
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3 text-xs">
                <dt className="text-muted-foreground">Referência</dt>
                <dd>{detail.payload.reference ?? "Não informada"}</dd>
                <dt className="text-muted-foreground">Laboratório</dt>
                <dd>{detail.payload.laboratory ?? "Não informado"}</dd>
                <dt className="text-muted-foreground">Método</dt>
                <dd>{detail.payload.method ?? "Não informado: comparação limitada"}</dd>
                <dt className="text-muted-foreground">Material</dt>
                <dd>{detail.payload.material ?? "Não informado"}</dd>
                <dt className="text-muted-foreground">Origem</dt>
                <dd className="break-words">{detail.documentTitle}</dd>
              </dl>
              {onOpenOriginal ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    const source = detail;
                    setDetail(null);
                    onOpenOriginal(source);
                  }}
                >
                  Abrir documento original
                </Button>
              ) : (
                <Source entry={detail} />
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
