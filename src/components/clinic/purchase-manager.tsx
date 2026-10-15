import { useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useInventory, type InventoryProduct } from "@/data/inventory-api";
import { purchaseInput, supplierInput, type Purchase, type Supplier } from "@/data/purchase-input";
import { useInventoryWrite } from "@/hooks/use-inventory-write";
import { InventoryState } from "./inventory-state";

const selectClass = "block h-10 w-full rounded-md border bg-background px-3";
const blank = () => ({ productId: "", quantity: "", unitCost: "" });
const statusLabel = { OPEN: "Aberto", PARTIAL: "Parcial", RECEIVED: "Recebido" };

function WriteFeedback({ write }: { write: ReturnType<typeof useInventoryWrite> }) {
  return write.error ? (
    <div role="alert" className="rounded-md border p-3">
      {write.error.message}
      {write.error.status === 401 && (
        <Link to="/estoque/acesso" className="ml-2 underline">
          Fazer login
        </Link>
      )}
      {write.uncertain && <p>Reenvie os mesmos dados para confirmar o resultado.</p>}
    </div>
  ) : null;
}

export function PurchaseManager({
  products,
  purchases,
  disabled,
  onSelect,
}: {
  products: InventoryProduct[];
  purchases: Purchase[];
  disabled: boolean;
  onSelect: (purchase: Purchase) => void;
}) {
  const suppliers = useInventory<Supplier[]>("suppliers");
  const supplierWrite = useInventoryWrite("suppliers");
  const purchaseWrite = useInventoryWrite("purchases");
  const [name, setName] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [reference, setReference] = useState("");
  const [items, setItems] = useState([blank()]);
  const [message, setMessage] = useState("");
  const [validation, setValidation] = useState("");
  async function saveSupplier(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    const parsed = supplierInput.safeParse({ id: crypto.randomUUID(), name });
    if (!parsed.success) {
      setValidation("Informe o nome do fornecedor.");
      return;
    }
    setValidation("");
    if (await supplierWrite.submit(parsed.data)) {
      setName("");
      setMessage("Fornecedor cadastrado.");
    }
  }
  async function savePurchase(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    const parsed = purchaseInput.safeParse({
      id: crypto.randomUUID(),
      reference,
      supplierId,
      items,
    });
    if (!parsed.success) {
      setValidation("Confira os itens e informe cada produto uma única vez.");
      return;
    }
    setValidation("");
    if (await purchaseWrite.submit(parsed.data)) {
      setReference("");
      setItems([blank()]);
      setMessage("Pedido criado. Selecione-o para registrar uma entrega.");
    }
  }
  const writesBusy =
    supplierWrite.pending ||
    supplierWrite.uncertain ||
    purchaseWrite.pending ||
    purchaseWrite.uncertain;
  return (
    <section className="space-y-4 rounded-xl border bg-card p-5" aria-label="Compras">
      <h2 className="text-lg font-semibold">Pedidos de compra</h2>
      {message && <p role="status">{message}</p>}
      {validation && <p role="alert">{validation}</p>}
      {purchases.length ? (
        <div className="space-y-3">
          {purchases.map((purchase) => (
            <div key={purchase.id} className="rounded-md border p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span>
                  <strong>{purchase.reference}</strong> · {purchase.supplier} ·{" "}
                  {statusLabel[purchase.status]}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  disabled={disabled || writesBusy || purchase.status === "RECEIVED"}
                  onClick={() => onSelect(purchase)}
                >
                  Receber {purchase.reference}
                </Button>
              </div>
              <ul className="mt-2 text-sm text-muted-foreground">
                {purchase.items.map((item) => (
                  <li key={item.id}>
                    {item.name}: pedido {item.quantity} · recebido {item.received} · pendente{" "}
                    {item.remaining}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <p>Nenhum pedido cadastrado.</p>
      )}
      <details>
        <summary className="cursor-pointer font-medium">Cadastrar fornecedor</summary>
        <form onSubmit={saveSupplier} className="mt-4 space-y-3">
          <WriteFeedback write={supplierWrite} />
          <fieldset
            disabled={
              disabled ||
              supplierWrite.pending ||
              supplierWrite.uncertain ||
              purchaseWrite.pending ||
              purchaseWrite.uncertain
            }
          >
            <label>
              Nome do fornecedor
              <Input
                required
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
          </fieldset>
          <Button
            type="submit"
            disabled={
              disabled || supplierWrite.pending || purchaseWrite.pending || purchaseWrite.uncertain
            }
          >
            {supplierWrite.uncertain ? "Reenviar fornecedor" : "Salvar fornecedor"}
          </Button>
        </form>
      </details>
      <details>
        <summary className="cursor-pointer font-medium">Criar pedido</summary>
        {suppliers.isPending ? (
          <InventoryState pending />
        ) : suppliers.error ? (
          <InventoryState error={suppliers.error} retry={() => void suppliers.refetch()} />
        ) : !suppliers.data.length ? (
          <p className="mt-3">Cadastre um fornecedor antes de criar o pedido.</p>
        ) : (
          <form onSubmit={savePurchase} className="mt-4 space-y-3">
            <WriteFeedback write={purchaseWrite} />
            <fieldset disabled={disabled || writesBusy} className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <label>
                  Fornecedor do pedido
                  <select
                    required
                    className={selectClass}
                    value={supplierId}
                    onChange={(e) => setSupplierId(e.target.value)}
                  >
                    <option value="">Selecione</option>
                    {suppliers.data.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Número do pedido
                  <Input
                    required
                    maxLength={100}
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                  />
                </label>
              </div>
              {items.map((item, index) => (
                <div key={index} className="grid gap-3 rounded-md border p-3 md:grid-cols-4">
                  <label>
                    Produto do pedido {index + 1}
                    <select
                      required
                      className={selectClass}
                      value={item.productId}
                      onChange={(e) =>
                        setItems((previous) =>
                          previous.map((line, i) =>
                            i === index ? { ...line, productId: e.target.value } : line,
                          ),
                        )
                      }
                    >
                      <option value="">Selecione</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Quantidade pedida {index + 1}
                    <Input
                      type="number"
                      required
                      min="0.001"
                      step="0.001"
                      value={item.quantity}
                      onChange={(e) =>
                        setItems((previous) =>
                          previous.map((line, i) =>
                            i === index ? { ...line, quantity: e.target.value } : line,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    Custo previsto {index + 1}
                    <Input
                      type="number"
                      required
                      min="0"
                      step="0.0001"
                      value={item.unitCost}
                      onChange={(e) =>
                        setItems((previous) =>
                          previous.map((line, i) =>
                            i === index ? { ...line, unitCost: e.target.value } : line,
                          ),
                        )
                      }
                    />
                  </label>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={items.length === 1}
                    onClick={() => setItems((previous) => previous.filter((_, i) => i !== index))}
                  >
                    Remover produto {index + 1}
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                disabled={items.length >= 50}
                onClick={() => setItems((previous) => [...previous, blank()])}
              >
                Adicionar produto ao pedido
              </Button>
            </fieldset>
            <Button
              type="submit"
              disabled={
                disabled ||
                purchaseWrite.pending ||
                supplierWrite.pending ||
                supplierWrite.uncertain
              }
            >
              {purchaseWrite.uncertain ? "Reenviar pedido" : "Salvar pedido"}
            </Button>
          </form>
        )}
      </details>
    </section>
  );
}
