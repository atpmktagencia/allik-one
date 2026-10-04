import { useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useInventory, type InventoryPosition } from "@/data/inventory-api";
import { transferInput, adjustmentInput } from "@/data/stock-operation-input";
import { useInventoryWrite } from "@/hooks/use-inventory-write";
import { InventoryState } from "./inventory-state";

const selectClass = "block h-10 w-full rounded-md border bg-background px-3";
function OperationForm({
  transfer,
  positions,
  locations,
  refresh,
}: {
  transfer: boolean;
  positions: InventoryPosition[];
  locations: { id: string; name: string }[];
  refresh: () => void;
}) {
  const write = useInventoryWrite(transfer ? "transfers" : "adjustments");
  const [selected, setSelected] = useState<InventoryPosition | null>(null);
  const [destinationId, setDestinationId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [validation, setValidation] = useState("");
  const choices = positions.filter(
    (position) =>
      position.id === selected?.id ||
      (position.active &&
        (!transfer || (position.status === "AVAILABLE" && position.quantity > 0))),
  );
  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    const common = { operationId: crypto.randomUUID(), lotId: selected?.lotId, reference, reason };
    const parsed = transfer
      ? transferInput.safeParse({
          ...common,
          sourceId: selected?.locationId,
          destinationId,
          quantity,
        })
      : adjustmentInput.safeParse({
          ...common,
          locationId: selected?.locationId,
          expectedQuantity: selected?.quantity.toFixed(3),
          countedQuantity: quantity,
        });
    if (!parsed.success) {
      setValidation(
        "Confira lote, quantidade e locais. Descreva o motivo em pelo menos 10 caracteres.",
      );
      return;
    }
    setValidation("");
    if (await write.submit(parsed.data)) {
      setMessage(
        transfer
          ? "Transferência registrada. Os saldos e o histórico foram atualizados."
          : "Ajuste registrado. O saldo e o histórico foram atualizados.",
      );
      setQuantity("");
      setReference("");
      setReason("");
      setSelected(null);
      setDestinationId("");
    }
  }
  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border bg-card p-5">
      <h3 className="font-semibold">
        {transfer ? "Transferir entre locais" : "Ajustar por contagem"}
      </h3>
      <p className="text-sm text-muted-foreground">
        {transfer
          ? "Transfira o mesmo lote, preservando o saldo total do produto."
          : "Informe a quantidade física encontrada. O ajuste registra a diferença em relação ao saldo consultado."}
      </p>
      {message && <p role="status">{message}</p>}
      {validation && <p role="alert">{validation}</p>}
      {write.error && (
        <div role="alert">
          {write.error.message}
          {write.error.status === 401 && (
            <Link to="/estoque/acesso" className="ml-2 underline">
              Acessar demonstração
            </Link>
          )}
          {write.error.status === 409 && (
            <Button
              type="button"
              variant="outline"
              className="ml-2"
              onClick={() => {
                setSelected(null);
                setQuantity("");
                refresh();
              }}
            >
              Atualizar saldos
            </Button>
          )}
          {write.uncertain && (
            <p>Reenvie os mesmos dados para confirmar sem duplicar a operação.</p>
          )}
        </div>
      )}
      <fieldset disabled={write.pending || write.uncertain} className="space-y-4">
        <label className="block space-y-2">
          {transfer ? "Posição de origem" : "Posição para contagem"}
          <select
            required
            className={selectClass}
            value={selected?.id ?? ""}
            onChange={(e) => {
              setSelected(choices.find((position) => position.id === e.target.value) ?? null);
              setQuantity("");
              setDestinationId("");
            }}
          >
            <option value="">Selecione o produto, lote e local</option>
            {choices.map((position) => (
              <option key={position.id} value={position.id}>
                {position.name} · {position.lot} · {position.location} · saldo {position.quantity}{" "}
                {position.unit}
              </option>
            ))}
          </select>
        </label>
        {selected && (
          <p className="text-sm">
            Saldo consultado:{" "}
            <strong>
              {selected.quantity} {selected.unit}
            </strong>
            {!transfer && selected.status !== "AVAILABLE" && (
              <span> · Lote indisponível para uso; a contagem mantém esse status.</span>
            )}
          </p>
        )}
        {transfer && (
          <label className="block space-y-2">
            Local de destino
            <select
              required
              className={selectClass}
              value={destinationId}
              onChange={(e) => setDestinationId(e.target.value)}
            >
              <option value="">Selecione</option>
              {locations
                .filter((location) => location.id !== selected?.locationId)
                .map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
            </select>
          </label>
        )}
        <label className="block space-y-2">
          {transfer ? "Quantidade a transferir" : "Quantidade contada"}
          <Input
            required
            type="number"
            min={transfer ? "0.001" : "0"}
            max={transfer ? selected?.quantity : "99999999999.999"}
            step="0.001"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </label>
        <label className="block space-y-2">
          {transfer ? "Referência da transferência" : "Referência da contagem"}
          <Input
            required
            maxLength={100}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </label>
        <label className="block space-y-2">
          {transfer ? "Motivo da transferência" : "Motivo do ajuste"}
          <Textarea
            required
            minLength={10}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
      </fieldset>
      <Button type="submit" disabled={write.pending || !selected}>
        {write.pending
          ? "Registrando…"
          : write.uncertain
            ? transfer
              ? "Reenviar transferência"
              : "Reenviar ajuste"
            : transfer
              ? "Confirmar transferência"
              : "Confirmar ajuste"}
      </Button>
    </form>
  );
}

export function StockOperationForms() {
  const stock = useInventory<InventoryPosition[]>("stock");
  const locations = useInventory<{ id: string; name: string }[]>("locations");
  const refresh = () => {
    void stock.refetch();
    void locations.refetch();
  };
  if (stock.isPending || locations.isPending) return <InventoryState pending />;
  if (stock.error || locations.error)
    return <InventoryState error={stock.error ?? locations.error} retry={refresh} />;
  if (!stock.data.length || !locations.data.length)
    return (
      <p role="status">
        Receba estoque em um local ativo antes de registrar transferências ou contagens.
      </p>
    );
  return (
    <section aria-label="Operações de estoque" className="grid gap-5 xl:grid-cols-2">
      <OperationForm transfer positions={stock.data} locations={locations.data} refresh={refresh} />
      <OperationForm
        transfer={false}
        positions={stock.data}
        locations={locations.data}
        refresh={refresh}
      />
    </section>
  );
}
