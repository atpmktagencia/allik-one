import { useState, type FormEvent } from "react";
import { AlertTriangle, FlaskConical } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useInventory } from "@/data/inventory-api";
import { InventoryState } from "./inventory-state";
import { PageHeader } from "./page-kit";

type OpenItem = {
  id: string;
  unitName: string;
  locationName: string;
  productName: string;
  sku: string;
  presentationName: string;
  lot: string;
  baseUnit: string;
  initialQuantity: string;
  remainingQuantity: string;
  consumedQuantity: string;
  lossQuantity: string;
  openedAt: string;
  usableUntil: string;
  status: string;
  version: number;
};
type Payload = { items: OpenItem[]; canDiscard: boolean };
const quantityFormatter = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 6 });
const number = (value: string) => quantityFormatter.format(Number(value));

export function OpenPresentationsPage() {
  const query = useInventory<Payload>("open-presentations");
  const [selected, setSelected] = useState<OpenItem | null>(null);
  const [type, setType] = useState<"EXPIRED" | "DAMAGE" | "DISCARD">("DISCARD");
  const [reason, setReason] = useState("Descarte operacional conferido da apresentação aberta.");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  if (query.isPending || query.error)
    return (
      <InventoryState pending={query.isPending} error={query.error} retry={() => query.refetch()} />
    );
  const data = query.data!;
  async function discard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/v1/inventory/open-presentations", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: crypto.randomUUID(),
          openPresentationId: selected.id,
          version: selected.version,
          type,
          reason,
        }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Não foi possível registrar o descarte.");
      await query.refetch();
      setSelected(null);
      setMessage("Descarte registrado e saldo fracionado encerrado.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha de conexão.");
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Controle fracionado"
        title="Apresentações abertas"
        description="Acompanhe saldo interno, prazo seguro de uso e perdas de ampolas ou frascos já retirados do estoque físico."
      />
      {message || error ? (
        <div role={error ? "alert" : "status"} className="rounded-lg border px-4 py-3 text-sm">
          {error || message}
        </div>
      ) : null}
      <div className="rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning-foreground">
        <AlertTriangle className="mr-2 inline size-4" /> Uma apresentação vencida após abertura não
        volta ao estoque e deve ser descartada com motivo.
      </div>
      <section className="overflow-hidden rounded-xl border bg-card">
        {data.items.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-left text-sm">
              <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-5 py-3">Produto</th>
                  <th className="px-4 py-3">Unidade / lote</th>
                  <th className="px-4 py-3">Equação física</th>
                  <th className="px-4 py-3">Prazo</th>
                  <th className="px-5 py-3">Situação</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.items.map((item) => (
                  <tr key={item.id}>
                    <td className="px-5 py-4">
                      <p className="font-medium">{item.productName}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.presentationName} · {item.sku}
                      </p>
                    </td>
                    <td className="px-4 py-4">
                      {item.unitName} · {item.locationName}
                      <p className="text-xs text-muted-foreground">Lote {item.lot}</p>
                    </td>
                    <td className="px-4 py-4">
                      <p>
                        {number(item.initialQuantity)} {item.baseUnit} iniciais
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {number(item.consumedQuantity)} consumidos · {number(item.lossQuantity)}{" "}
                        perdidos · {number(item.remainingQuantity)} restantes
                      </p>
                    </td>
                    <td className="px-4 py-4">
                      <p>
                        Até{" "}
                        {new Date(item.usableUntil).toLocaleString("pt-BR", {
                          timeZone: "America/Fortaleza",
                        })}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Aberta em{" "}
                        {new Date(item.openedAt).toLocaleString("pt-BR", {
                          timeZone: "America/Fortaleza",
                        })}
                      </p>
                    </td>
                    <td className="px-5 py-4">
                      <Badge variant={item.status === "OPEN" ? "default" : "outline"}>
                        {item.status === "OPEN"
                          ? "Aberta"
                          : item.status === "DEPLETED"
                            ? "Esgotada"
                            : "Descartada"}
                      </Badge>
                      {item.status === "OPEN" && data.canDiscard ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="ml-2"
                          onClick={() => setSelected(item)}
                        >
                          Descartar
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-10 text-center text-sm text-muted-foreground">
            <FlaskConical className="mx-auto mb-3 size-8" />
            Nenhuma apresentação foi aberta.
          </div>
        )}
      </section>
      {selected ? (
        <form onSubmit={discard} className="space-y-4 rounded-xl border bg-card p-5">
          <h2 className="font-semibold">Descartar saldo de {selected.productName}</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1 text-sm font-medium">
              Tipo
              <select
                className="h-10 w-full rounded-md border bg-background px-3"
                value={type}
                onChange={(event) => setType(event.target.value as typeof type)}
              >
                <option value="DISCARD">Descarte operacional</option>
                <option value="EXPIRED">Prazo após abertura vencido</option>
                <option value="DAMAGE">Avaria</option>
              </select>
            </label>
            <label className="space-y-1 text-sm font-medium">
              Motivo
              <Input
                required
                minLength={10}
                maxLength={500}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
          </div>
          <div className="flex gap-3">
            <Button disabled={pending}>
              {pending
                ? "Registrando…"
                : `Descartar ${number(selected.remainingQuantity)} ${selected.baseUnit}`}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setSelected(null)}
            >
              Cancelar
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
