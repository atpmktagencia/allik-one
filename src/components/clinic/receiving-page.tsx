import { useRef, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useInventory, InventoryError, type InventoryProduct } from "@/data/inventory-api";
import { receiptInput, type ReceiptInput } from "@/data/receipt-input";
import { formatBRL } from "@/data/mock-stock";
import { InventoryState } from "./inventory-state";
import { PurchaseManager } from "./purchase-manager";
import type { Purchase } from "@/data/purchase-input";

type Line = {
  productId: string;
  purchaseItemId?: string | undefined;
  lot: string;
  expiry: string;
  quantity: string;
  unitCost: string;
};
const emptyLine = (): Line => ({ productId: "", lot: "", expiry: "", quantity: "", unitCost: "" });

export function ReceivingPage() {
  const products = useInventory<InventoryProduct[]>("products");
  const locations = useInventory<{ id: string; name: string }[]>("locations");
  const purchases = useInventory<Purchase[]>("purchases");
  const queryClient = useQueryClient();
  const [supplier, setSupplier] = useState("");
  const [reference, setReference] = useState("");
  const [locationId, setLocationId] = useState("");
  const [purchaseId, setPurchaseId] = useState("");
  const [items, setItems] = useState<Line[]>([emptyLine()]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<InventoryError | null>(null);
  const [saved, setSaved] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const submitted = useRef<ReceiptInput | null>(null);
  const inFlight = useRef(false);
  const total = items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unitCost), 0);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || saved) return;
    const parsed = receiptInput.safeParse(
      submitted.current ?? {
        operationId: crypto.randomUUID(),
        purchaseId: purchaseId || undefined,
        supplier,
        reference,
        locationId,
        items,
      },
    );
    if (!parsed.success) {
      setError(
        new InventoryError(
          "Confira todos os campos. Use quantidade positiva e custo não negativo.",
          400,
        ),
      );
      return;
    }
    submitted.current = parsed.data;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/inventory/receipts", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(submitted.current),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new InventoryError(
          body.error ?? "Não foi possível registrar o recebimento.",
          response.status,
        );
      setSaved(true);
      setUncertain(false);
      await queryClient.invalidateQueries({ queryKey: ["inventory"] });
    } catch (cause) {
      const failure =
        cause instanceof InventoryError
          ? cause
          : new InventoryError(
              "Não foi possível confirmar o resultado. Tente novamente com os mesmos dados.",
              503,
            );
      // Keep the original request and key after an ambiguous network/server failure.
      const retrySame = failure.status >= 500;
      setUncertain(retrySame);
      if (!retrySame) submitted.current = null;
      setError(failure);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  if (products.isPending || locations.isPending || purchases.isPending)
    return <InventoryState pending />;
  if (products.error || locations.error || purchases.error)
    return (
      <InventoryState
        error={products.error ?? locations.error ?? purchases.error}
        retry={() => {
          void products.refetch();
          void locations.refetch();
          void purchases.refetch();
        }}
      />
    );
  const availableProducts = products.data.filter((p) => p.active && p.stockControlled);
  const selectedPurchase = purchases.data.find((purchase) => purchase.id === purchaseId);
  const selectableProducts = purchaseId
    ? availableProducts.filter((product) =>
        selectedPurchase?.items.some(
          (item) => item.productId === product.id && Number(item.remaining) > 0,
        ),
      )
    : availableProducts;
  if (!availableProducts.length || !locations.data.length)
    return <div role="status">Cadastre produtos e locais ativos antes de receber uma compra.</div>;

  function update(index: number, key: keyof Line, value: string) {
    if (key === "productId" && selectedPurchase) {
      const orderItem = selectedPurchase.items.find((item) => item.productId === value);
      setItems((previous) =>
        previous.map((item, i) =>
          i === index
            ? {
                ...item,
                productId: value,
                purchaseItemId: orderItem?.id,
                unitCost: orderItem?.unitCost ?? "",
                quantity: "",
              }
            : item,
        ),
      );
      return;
    }
    setItems((previous) =>
      previous.map((item, i) => (i === index ? { ...item, [key]: value } : item)),
    );
  }
  return (
    <div className="space-y-6">
      <PurchaseManager
        products={availableProducts}
        purchases={purchases.data}
        disabled={pending || uncertain}
        onSelect={(purchase) => {
          submitted.current = null;
          setPurchaseId(purchase.id);
          setSupplier(purchase.supplier);
          setReference(purchase.reference);
          setSaved(false);
          setError(null);
          setItems(
            purchase.items
              .filter((item) => Number(item.remaining) > 0)
              .map((item) => ({
                productId: item.productId,
                purchaseItemId: item.id,
                unitCost: item.unitCost,
                quantity: item.remaining,
                lot: "",
                expiry: "",
              })),
          );
        }}
      />
      <form onSubmit={submit} className="space-y-6">
        <div>
          <p className="text-xs text-muted-foreground">Estoque · Entrada</p>
          <h1 className="text-2xl font-semibold">Receber compra</h1>
          <p className="text-sm text-muted-foreground">
            Informe os itens entregues para registrar a entrada no estoque.
          </p>
        </div>
        {saved && (
          <div role="status" className="rounded-xl border p-4">
            Recebimento registrado. O saldo e o histórico foram atualizados.{" "}
            <Link to="/estoque" className="underline">
              Ver estoque
            </Link>
            <Button
              type="button"
              variant="outline"
              className="ml-3"
              onClick={() => {
                submitted.current = null;
                setItems([emptyLine()]);
                setReference("");
                setPurchaseId("");
                setSupplier("");
                setSaved(false);
              }}
            >
              Novo recebimento
            </Button>
          </div>
        )}
        {error && (
          <div role="alert" className="rounded-xl border p-4">
            {error.message}
            {error.status === 401 && (
              <Link to="/estoque/acesso" className="ml-2 underline">
                Acessar demonstração
              </Link>
            )}
          </div>
        )}
        <fieldset disabled={pending || saved || uncertain} className="space-y-5">
          {purchaseId && (
            <div className="rounded-md border p-3">
              <p>
                Pedido selecionado: <strong>{reference}</strong>. Informe apenas a quantidade
                entregue nesta remessa.
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setPurchaseId("");
                  setItems([emptyLine()]);
                  setSupplier("");
                  setReference("");
                }}
              >
                Entrada sem pedido
              </Button>
            </div>
          )}
          <div className="grid gap-4 rounded-xl border bg-card p-5 md:grid-cols-3">
            <label className="space-y-2">
              Fornecedor
              <Input
                required
                maxLength={100}
                value={supplier}
                readOnly={Boolean(purchaseId)}
                onChange={(e) => setSupplier(e.target.value)}
              />
            </label>
            <label className="space-y-2">
              Referência da compra
              <Input
                required
                maxLength={100}
                value={reference}
                readOnly={Boolean(purchaseId)}
                onChange={(e) => setReference(e.target.value)}
              />
            </label>
            <label className="space-y-2">
              Localização
              <select
                required
                className="block h-10 w-full rounded-md border bg-background px-3"
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
              >
                <option value="">Selecione</option>
                {locations.data.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {items.map((item, index) => (
            <div key={index} className="grid gap-4 rounded-xl border bg-card p-5 md:grid-cols-3">
              <label className="space-y-2">
                Produto {index + 1}
                <select
                  required
                  className="block h-10 w-full rounded-md border bg-background px-3"
                  value={item.productId}
                  onChange={(e) => update(index, "productId", e.target.value)}
                >
                  <option value="">Selecione</option>
                  {selectableProducts.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name} · {product.unit}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-2">
                Lote {index + 1}
                <Input
                  required
                  maxLength={100}
                  value={item.lot}
                  onChange={(e) => update(index, "lot", e.target.value)}
                />
              </label>
              <label className="space-y-2">
                Validade {index + 1}
                <Input
                  required
                  type="date"
                  value={item.expiry}
                  onChange={(e) => update(index, "expiry", e.target.value)}
                />
              </label>
              <label className="space-y-2">
                Quantidade {index + 1}
                <Input
                  required
                  type="number"
                  min="0.001"
                  max={
                    purchaseId
                      ? selectedPurchase?.items.find((line) => line.id === item.purchaseItemId)
                          ?.remaining
                      : "99999999999.999"
                  }
                  step="0.001"
                  value={item.quantity}
                  onChange={(e) => update(index, "quantity", e.target.value)}
                />
              </label>
              <label className="space-y-2">
                Custo unitário {index + 1}
                <Input
                  required
                  type="number"
                  min="0"
                  max="9999999999.9999"
                  step="0.0001"
                  value={item.unitCost}
                  readOnly={Boolean(purchaseId)}
                  onChange={(e) => update(index, "unitCost", e.target.value)}
                />
              </label>
              <div className="flex items-end gap-3">
                <span>Subtotal: {formatBRL(Number(item.quantity) * Number(item.unitCost))}</span>
                <Button
                  type="button"
                  variant="outline"
                  disabled={items.length === 1}
                  onClick={() => setItems((previous) => previous.filter((_, i) => i !== index))}
                >
                  Remover item {index + 1}
                </Button>
              </div>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            disabled={items.length >= 50}
            onClick={() => setItems((previous) => [...previous, emptyLine()])}
          >
            Adicionar item
          </Button>
        </fieldset>
        <div className="rounded-xl border bg-card p-5">
          <p>
            Total: <strong>{formatBRL(total)}</strong>
          </p>
          {uncertain && (
            <p role="status" className="mt-2 text-sm">
              Reenvie os mesmos dados para confirmar o resultado sem duplicar a entrada.
            </p>
          )}
          <Button className="mt-4" disabled={pending || saved} type="submit">
            {pending ? "Registrando…" : uncertain ? "Tentar novamente" : "Confirmar recebimento"}
          </Button>
        </div>
      </form>
    </div>
  );
}
