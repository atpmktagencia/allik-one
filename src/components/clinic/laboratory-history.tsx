import { Fragment, useMemo, useState } from "react";
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
const labelDate = (date: string) =>
  date === "undated" ? "Sem data de exame" : date.split("-").reverse().join("/");
function ReferenceStatus({ entry }: { entry: LaboratoryHistoryEntry }) {
  const status = laboratoryHistoryReference(entry);
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
function Source({ entry }: { entry: LaboratoryHistoryEntry }) {
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
function HistoryGraph({ group }: { group: LaboratoryHistoryGroup }) {
  const { points, segments } = laboratoryHistorySeries(group);
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
            <ReferenceStatus entry={p.entry} />
            <Source entry={p.entry} />
          </li>
        ))}
      </ul>
    </div>
  );
}
export function LaboratoryHistory({ patientId }: { patientId: string }) {
  const [dateFrom, setDateFrom] = useState("");
  const [offset, setOffset] = useState(0);
  const [dateTo, setDateTo] = useState("");
  const invalidRange =
    (!!dateFrom && !laboratoryDate.safeParse(dateFrom).success) ||
    (!!dateTo && !laboratoryDate.safeParse(dateTo).success) ||
    (!!dateFrom && !!dateTo && dateFrom > dateTo);
  const resource =
    `laboratory-history?patientId=${encodeURIComponent(patientId)}` +
    (dateFrom ? `&dateFrom=${dateFrom}` : "") +
    (dateTo ? `&dateTo=${dateTo}` : "") +
    (offset ? `&offset=${offset}` : "");
  const query = useInventory<Payload>(resource, { enabled: !invalidRange });
  const [search, setSearch] = useState("");
  const [groupLimit, setGroupLimit] = useState(50);
  const [dateOffset, setDateOffset] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const history = useMemo(() => buildLaboratoryHistory(query.data?.rows ?? []), [query.data]);
  const groups = useMemo(
    () =>
      history.groups.filter((g) =>
        g.name.toLocaleLowerCase("pt-BR").includes(search.trim().toLocaleLowerCase("pt-BR")),
      ),
    [history.groups, search],
  );
  const relevantDates = useMemo(() => {
    const dates = new Set(
      groups.flatMap((group) =>
        group.entries.map((entry) => laboratoryHistoryDate(entry) ?? "undated"),
      ),
    );
    return history.dates.filter((date) => dates.has(date));
  }, [groups, history.dates]);
  const endDate = Math.max(
    1,
    relevantDates.length - Math.min(dateOffset, Math.max(0, relevantDates.length - 1)),
  );
  const startDate = Math.max(0, endDate - 12);
  const visibleDates = relevantDates.slice(startDate, endDate);
  return (
    <section className="min-w-0 space-y-4" aria-label="Histórico longitudinal de exames">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">Resultados laboratoriais</h3>
          <p className="text-sm text-muted-foreground">
            Somente resultados confirmados. Unidades, métodos, material e laboratórios diferentes
            permanecem separados.
          </p>
        </div>
        <Input
          className="max-w-xs"
          aria-label="Buscar parâmetro laboratorial"
          placeholder="Buscar exame…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setGroupLimit(50);
            setDateOffset(0);
          }}
        />
      </div>
      <div className="flex flex-wrap gap-3">
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
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span>
              Comparação limitada aos resultados desta página. Página {Math.floor(offset / 500) + 1}
              .
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
          {!!groups.length && (
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
            <div className="max-h-[70vh] overflow-auto rounded-xl border">
              <table
                className="w-full min-w-[800px] text-left text-sm"
                aria-label="Tabela longitudinal de exames"
              >
                <thead className="sticky top-0 z-20 bg-white">
                  <tr>
                    <th className="sticky left-0 z-30 w-56 min-w-56 max-w-56 bg-white p-3">
                      Exame
                    </th>
                    <th className="md:sticky md:left-56 z-30 w-28 min-w-28 max-w-28 bg-white p-3">
                      Unidade
                    </th>
                    <th className="md:sticky md:left-[21rem] z-30 w-48 min-w-48 max-w-48 bg-white p-3">
                      Referência do laboratório
                    </th>
                    {visibleDates.map((date) => (
                      <th className="min-w-44 p-3" key={date}>
                        {labelDate(date)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {groups.slice(0, groupLimit).map((group) => (
                    <Fragment key={group.id}>
                      <tr className="border-t align-top">
                        <th
                          scope="row"
                          className="sticky left-0 z-10 w-56 min-w-56 max-w-56 bg-white p-3"
                        >
                          <Button
                            className="h-auto whitespace-normal p-0 text-left"
                            variant="link"
                            aria-expanded={expanded === group.id}
                            onClick={() => setExpanded(expanded === group.id ? null : group.id)}
                          >
                            {group.name}
                          </Button>
                          <p className="mt-1 text-xs font-normal text-muted-foreground">
                            {group.method ?? "Método não informado: comparação limitada"}
                            {group.material
                              ? ` · ${group.material}`
                              : " · Material não informado: comparação limitada"}
                            {group.laboratory
                              ? ` · ${group.laboratory}`
                              : " · Laboratório não informado: comparação limitada"}
                          </p>
                        </th>
                        <td className="md:sticky md:left-56 z-10 w-28 min-w-28 max-w-28 bg-white p-3">
                          {group.unit ?? "Não informada"}
                        </td>
                        <td className="md:sticky md:left-[21rem] z-10 w-48 min-w-48 max-w-48 bg-white p-3 text-xs">
                          {[
                            ...new Set(
                              group.entries.map((e) => e.payload.reference ?? "Não informada"),
                            ),
                          ].join(" · ")}
                          <p className="mt-1 text-muted-foreground">
                            Confira a referência em cada resultado.
                          </p>
                        </td>
                        {visibleDates.map((date) => (
                          <td key={date} className="p-3">
                            {group.entries
                              .filter((e) => (laboratoryHistoryDate(e) ?? "undated") === date)
                              .map((entry) => (
                                <div className="mb-3 space-y-1 last:mb-0" key={entry.id}>
                                  <p className="font-medium">{entry.payload.result}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {entry.payload.collectedOn
                                      ? "Data de coleta"
                                      : entry.payload.reportedOn
                                        ? "Data do resultado"
                                        : "Data não informada"}
                                  </p>
                                  <ReferenceStatus entry={entry} />
                                  <p className="text-xs text-muted-foreground">
                                    Ref.: {entry.payload.reference ?? "Não informada"}
                                  </p>
                                  <Source entry={entry} />
                                </div>
                              ))}
                          </td>
                        ))}
                      </tr>
                      {expanded === group.id && (
                        <tr>
                          <td colSpan={visibleDates.length + 3}>
                            <HistoryGraph group={group} />
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
    </section>
  );
}
