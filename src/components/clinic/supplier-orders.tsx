import { useRef, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useInventory } from "@/data/inventory-api";
import { useInventoryWrite } from "@/hooks/use-inventory-write";
import {
  supplierOrderInput,
  type SupplierProfile,
  type SupplierCatalogItem,
  type SupplierOrder,
} from "@/data/supplier-input";
import { cents, decimalMoney, money, orderMessage } from "@/data/order-export";
import { InventoryState } from "./inventory-state";
export type OrderSelection = { item: SupplierCatalogItem; quantity: number };

export function SavedSupplierOrder({ id, onClose }: { id: string; onClose: () => void }) {
  const query = useInventory<SupplierOrder>(`vendor-orders?id=${id}`);
  const [copyStatus, setCopyStatus] = useState("");
  if (query.isPending) return <InventoryState pending />;
  if (query.error)
    return (
      <InventoryState
        error={query.error}
        retry={() => {
          void query.refetch();
        }}
      />
    );
  const order = query.data;
  const message = orderMessage(order);
  const encodedMessage = encodeURIComponent(message);
  const longMessage = encodedMessage.length > 6000;
  const exportUrl = (format: string) =>
    `/api/v1/inventory/vendor-orders?id=${order.id}&format=${format}`;
  return (
    <section
      aria-label={`Pedido ${order.reference}`}
      className="space-y-4 rounded-xl border bg-card p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Pedido {order.reference}</h2>
        <Button variant="ghost" onClick={onClose}>
          Fechar pedido
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Pedido salvo para acompanhamento e recebimento. Confirme a cotação com o fornecedor antes de
        enviar.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline">
          <a href={exportUrl("csv")}>Exportar CSV</a>
        </Button>
        <Button asChild variant="outline">
          <a href={exportUrl("txt")}>Exportar lista</a>
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(message);
              setCopyStatus("Lista copiada.");
            } catch {
              setCopyStatus("Selecione e copie a lista abaixo ou use Exportar lista.");
            }
          }}
        >
          Copiar mensagem
        </Button>
        <Button asChild variant="outline">
          <a href={exportUrl("html")} target="_blank" rel="noopener noreferrer">
            Imprimir / PDF
          </a>
        </Button>
        {order.supplier.phone ? (
          <Button asChild>
            <a
              href={`https://wa.me/${order.supplier.phone}${longMessage ? "" : `?text=${encodedMessage}`}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {longMessage ? "Abrir WhatsApp (copie a lista)" : "Revisar e enviar no WhatsApp"}
            </a>
          </Button>
        ) : (
          <p className="text-sm">Cadastre o WhatsApp do fornecedor para abrir a mensagem.</p>
        )}
        <Button asChild variant="outline">
          <Link to="/estoque/recebimento">Receber pedido</Link>
        </Button>
      </div>
      {longMessage && (
        <p className="text-sm text-muted-foreground">
          Esta lista é extensa. Copie a mensagem e cole no WhatsApp, ou anexe a lista exportada.
        </p>
      )}
      {copyStatus && (
        <p role="status" className="text-sm">
          {copyStatus}
        </p>
      )}
      <pre className="whitespace-pre-wrap break-words rounded-md bg-muted/50 p-4 font-sans text-sm leading-relaxed">
        {message}
      </pre>
      <p className="text-xs text-muted-foreground">
        Valores e contato preservados na data do pedido:{" "}
        {new Date(order.date).toLocaleString("pt-BR", { timeZone: "America/Fortaleza" })}. O estoque
        é atualizado ao receber a entrega.
      </p>
    </section>
  );
}

export function SupplierCheckout({
  supplier,
  selection,
  onClose,
  onSaved,
}: {
  supplier: SupplierProfile;
  selection: OrderSelection[];
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const operation = useRef(crypto.randomUUID());
  const [reference, setReference] = useState(
    () => `ALLIK-${new Date().toISOString().slice(0, 10)}-${operation.current.slice(0, 8)}`,
  );
  const [freight, setFreight] = useState("");
  const [notes, setNotes] = useState("");
  const [validation, setValidation] = useState("");
  const write = useInventoryWrite("vendor-orders");
  const busy = write.pending || write.uncertain;
  const subtotal = selection.reduce(
    (sum, s) => sum + cents(s.item.price!) * BigInt(s.quantity),
    0n,
  );
  const freightValid = /^\d{1,11}(\.\d{1,2})?$/.test(freight);
  const total = subtotal + (freightValid ? cents(freight) : 0n);
  async function save(event: FormEvent) {
    event.preventDefault();
    const parsed = supplierOrderInput.safeParse({
      operationId: operation.current,
      reference,
      supplierId: supplier.id,
      supplierVersion: supplier.version,
      freight: freight === "" ? null : freight,
      notes,
      items: selection.map(({ item, quantity }) => ({
        catalogItemId: item.id,
        quantity,
        version: item.version,
        expectedPrice: item.price,
      })),
    });
    if (!parsed.success) {
      setValidation("Confira a referência, o frete e as quantidades do pedido (até 50 itens).");
      return;
    }
    setValidation("");
    if (await write.submit(parsed.data)) onSaved(operation.current);
  }
  return (
    <section aria-label="Revisão do pedido" className="space-y-4 rounded-xl border bg-card p-5">
      <h2 className="text-lg font-semibold">Revisar pedido · {supplier.name}</h2>
      <ul className="space-y-3">
        {selection.map(({ item, quantity }) => (
          <li key={item.id} className="break-words border-b pb-3 text-sm">
            <strong>
              {item.code} · {item.name}
            </strong>
            <p>
              {quantity} × {item.packaging}
              {item.boxesPerPack !== null ? ` · ${quantity * item.boxesPerPack} boxes físicos` : ""}
            </p>
            <p>
              {money(item.price!)} por apresentação ·{" "}
              {money(decimalMoney(cents(item.price!) * BigInt(quantity)))}
            </p>
          </li>
        ))}
      </ul>
      <form onSubmit={save} className="space-y-4">
        <fieldset disabled={busy} className="space-y-4">
          <label className="block space-y-1">
            <span>Referência do pedido</span>
            <Input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              required
              maxLength={100}
            />
          </label>
          <label className="block space-y-1">
            <span>Frete estimado (R$, opcional)</span>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={freight}
              onChange={(e) => setFreight(e.target.value)}
            />
          </label>
          <label className="block space-y-1">
            <span>Observações do pedido</span>
            <textarea
              className="min-h-20 w-full rounded-md border bg-background p-3"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={2000}
            />
          </label>
        </fieldset>
        <p>
          Subtotal dos produtos: <strong>{money(decimalMoney(subtotal))}</strong>
        </p>
        <p className="text-lg">
          Total estimado: <strong>{money(decimalMoney(total))}</strong>
        </p>
        <p className="text-sm text-muted-foreground">
          {freight === ""
            ? "Frete a confirmar, não incluído no total."
            : "Frete informado incluído no total."}{" "}
          Preços do catálogo sujeitos à confirmação pelo fornecedor.
        </p>
        {(validation || write.error) && (
          <div role="alert" className="rounded-md border p-3 text-sm">
            {validation || write.error?.message}
            {write.error?.status === 401 && (
              <Link to="/estoque/acesso" target="_blank" className="ml-2 underline">
                Acessar demonstração
              </Link>
            )}
          </div>
        )}
        {write.uncertain && (
          <p role="status" className="text-sm">
            Resultado não confirmado. Reenvie os mesmos dados para conferir sem duplicar o pedido.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            Voltar ao catálogo
          </Button>
          <Button type="submit" disabled={write.pending}>
            {write.pending
              ? "Salvando pedido…"
              : write.uncertain
                ? "Tentar novamente"
                : "Salvar pedido e exportar"}
          </Button>
        </div>
      </form>
    </section>
  );
}
