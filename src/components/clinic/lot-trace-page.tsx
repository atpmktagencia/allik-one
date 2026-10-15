import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { fetchInventory, formatExpiry } from "@/data/inventory-api";
import { applicationPatients } from "@/data/mock-clinic";
import { movementLabels, type LotTrace } from "@/data/lot-trace";
import { InventoryState } from "./inventory-state";
import { SectionHeader } from "./section-header";

const date = (value: string) =>
  new Date(value).toLocaleString("pt-BR", { timeZone: "America/Fortaleza" });
const lotStatus: Record<string, string> = {
  AVAILABLE: "Disponível",
  EXPIRED: "Vencido",
  BLOCKED: "Bloqueado",
  QUARANTINED: "Quarentena",
};

export function LotTracePage({ lotId }: { lotId: string }) {
  const query = useInfiniteQuery({
    queryKey: ["inventory", "lot-trace", lotId],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      fetchInventory<LotTrace>(
        `trace/lots/${encodeURIComponent(lotId)}${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ""}`,
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
    staleTime: 15000,
  });
  if (query.isPending) return <InventoryState pending />;
  if (!query.data) return <InventoryState error={query.error} retry={() => void query.refetch()} />;
  const trace = query.data.pages[0]!;
  const events = query.data.pages.flatMap((page) => page.events);
  return (
    <div className="space-y-7">
      <SectionHeader
        eyebrow="Estoque · Rastreabilidade"
        title={`Rastreabilidade do lote ${trace.lot.number}`}
        description={`${trace.lot.product} · ${trace.lot.supplier} · validade ${formatExpiry(trace.lot.expiry)}`}
        action={
          <Button asChild variant="outline">
            <Link to="/estoque/produtos/$productId" params={{ productId: trace.lot.productId }}>
              Ver produto
            </Link>
          </Button>
        }
      />
      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4 text-sm">
        <Badge variant="outline">{lotStatus[trace.lot.status] ?? trace.lot.status}</Badge>
        {!trace.lot.productActive && <Badge variant="outline">Produto inativo</Badge>}
        <span>
          {trace.summary.totalEvents} movimentações · {trace.summary.auditEntries} registros de
          auditoria
        </span>
        <Button
          type="button"
          variant="outline"
          className="ml-auto"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          Atualizar rastreabilidade
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Saldo físico", value: trace.summary.balanceQuantity },
          { label: "Entradas", value: trace.summary.received },
          { label: "Aplicado", value: trace.summary.consumed },
          { label: "Ajustes", value: trace.summary.adjusted },
        ].map((item) => (
          <div key={item.label} className="rounded-xl border bg-card p-5">
            <p className="text-sm text-muted-foreground">{item.label}</p>
            <p className="mt-2 text-xl font-semibold">
              {item.value} {trace.lot.unit}
            </p>
          </div>
        ))}
      </div>
      <section
        aria-label="Conferência dos saldos"
        className="space-y-4 rounded-xl border bg-card p-5"
      >
        <h2 className="font-semibold">Saldos por local</h2>
        <p role={trace.summary.reconciled ? "status" : "alert"}>
          {trace.summary.reconciled
            ? "Saldos conferidos com as movimentações registradas."
            : "Há divergência entre o saldo e as movimentações registradas."}
        </p>
        {trace.summary.auditedEvents !== trace.summary.totalEvents && (
          <p role="alert">
            Auditoria presente em {trace.summary.auditedEvents} de {trace.summary.totalEvents}{" "}
            movimentos. Consulte os registros abaixo.
          </p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-sm">
            <thead className="text-left text-muted-foreground">
              <tr>
                {["Local", "Saldo físico", "Saldo pelos movimentos", "Conferência"].map((label) => (
                  <th key={label} className="px-3 py-2 font-medium">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {trace.balances.map((balance) => (
                <tr key={balance.locationId} className="border-t">
                  <td className="px-3 py-3">
                    {balance.location}
                    {!balance.active && " · Inativo"}
                  </td>
                  <td className="px-3 py-3">
                    {balance.quantity} {trace.lot.unit}
                  </td>
                  <td className="px-3 py-3">
                    {balance.ledgerQuantity} {trace.lot.unit}
                  </td>
                  <td className="px-3 py-3">{balance.matches ? "Confere" : "Divergência"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {trace.balances.length === 0 && <p>O lote ainda não possui posição de estoque.</p>}
      </section>
      <section aria-label="Caminho do lote" className="space-y-4">
        <div>
          <h2 className="font-semibold">Caminho do lote</h2>
          <p className="text-sm text-muted-foreground">
            Da movimentação mais recente à mais antiga, com origem, consumo e auditoria.
          </p>
        </div>
        {events.length === 0 && <p>Nenhuma movimentação registrada para este lote.</p>}
        <ol className="space-y-4">
          {events.map((event) => (
            <li key={event.id} className="space-y-3 rounded-xl border bg-card p-5">
              <div className="flex flex-wrap items-center gap-3">
                <Badge variant="outline">{movementLabels[event.type] ?? event.type}</Badge>
                <strong>
                  {Number(event.quantity) > 0 ? "+" : ""}
                  {event.quantity} {trace.lot.unit}
                </strong>
                <span className="text-xs text-muted-foreground">{date(event.date)}</span>
              </div>
              <p className="font-medium">
                {event.reference} · {event.location}
              </p>
              <p className="text-sm text-muted-foreground">
                {event.reason} · Responsável: {event.actor}
              </p>
              {event.receiptId ? (
                <div className="rounded-lg bg-muted/30 p-3 text-sm">
                  <p>Recebimento: {event.receiptReference}</p>
                  <p>
                    {event.purchaseId
                      ? `Pedido: ${event.purchaseReference}`
                      : "Entrada direta, sem pedido vinculado."}{" "}
                    · Fornecedor: {event.supplier ?? trace.lot.supplier}
                  </p>
                </div>
              ) : (
                event.type === "IN" && (
                  <p className="text-sm text-muted-foreground">
                    {event.actor === "seed-synthetic"
                      ? "Saldo inicial sintético."
                      : "Entrada sem recebimento vinculado."}
                  </p>
                )
              )}
              {event.operationId && (
                <p className="text-sm">
                  {event.type === "TRANSFER"
                    ? `Transferência: ${event.origin} → ${event.destination}`
                    : `Contagem física em ${event.origin}`}
                </p>
              )}
              {event.applicationId && (
                <div className="rounded-lg bg-muted/30 p-3 text-sm">
                  <p>
                    Aplicação: {event.applicationReference} ·{" "}
                    {applicationPatients.find((patient) => patient.id === event.patientRef)?.name ??
                      "Paciente sintético"}
                  </p>
                  <p>
                    {event.service} · Executor: {event.professional}
                  </p>
                  <Link to="/aplicacoes" className="underline">
                    Ver aplicações
                  </Link>
                </div>
              )}
              <details className="text-sm">
                <summary className="cursor-pointer font-medium">
                  Auditoria do movimento ({event.audit.length})
                </summary>
                {event.audit.length ? (
                  <ul className="mt-3 space-y-2">
                    {event.audit.map((entry) => (
                      <li key={entry.id}>
                        {movementLabels[entry.action] ?? entry.action} · {entry.actor} ·{" "}
                        {date(entry.date)}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3">Nenhum registro de auditoria encontrado.</p>
                )}
              </details>
            </li>
          ))}
        </ol>
        {query.error && (
          <div role="alert">
            {query.error.message}
            <Button
              type="button"
              variant="outline"
              className="ml-2"
              onClick={() => void (query.hasNextPage ? query.fetchNextPage() : query.refetch())}
            >
              Tentar novamente
            </Button>
          </div>
        )}
        {query.hasNextPage && (
          <Button
            type="button"
            variant="outline"
            disabled={query.isFetching}
            onClick={() => void query.fetchNextPage()}
          >
            {query.isFetchingNextPage ? "Carregando…" : "Carregar mais movimentações"}
          </Button>
        )}
      </section>
    </div>
  );
}
