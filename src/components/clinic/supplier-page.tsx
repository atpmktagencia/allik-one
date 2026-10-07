import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useInventory } from "@/data/inventory-api";
import type { SupplierProfile, SupplierCatalogItem, SupplierOrder } from "@/data/supplier-input";
import { cents, decimalMoney, money } from "@/data/order-export";
import { SectionHeader } from "./section-header";
import { InventoryState } from "./inventory-state";
import { SupplierForm } from "./supplier-forms";
import { SavedSupplierOrder, SupplierCheckout, type OrderSelection } from "./supplier-orders";

function SupplierHistory({ supplierId, onClose }: { supplierId: string; onClose: () => void }) {
  const history = useInventory<
    {
      id: string;
      catalogItemId: string | null;
      action: string;
      reason: string;
      actor: string;
      date: string;
      before: Record<string, unknown> | null;
      after: Record<string, unknown>;
    }[]
  >(`vendor-history?supplierId=${supplierId}`);
  const label = (v: unknown) =>
    v === null ? "Não informado" : typeof v === "boolean" ? (v ? "Ativo" : "Inativo") : String(v);
  return (
    <section
      aria-label="Histórico do fornecedor"
      className="space-y-3 rounded-xl border bg-card p-5"
    >
      <div className="flex justify-between gap-2">
        <h2 className="font-semibold">Últimas 50 alterações</h2>
        <Button variant="ghost" onClick={onClose}>
          Fechar histórico
        </Button>
      </div>
      {history.isPending ? (
        <InventoryState pending />
      ) : history.error ? (
        <InventoryState error={history.error} />
      ) : (
        <ol className="space-y-3">
          {history.data.map((h) => (
            <li key={h.id} className="rounded-md border p-3 text-sm">
              <p className="font-medium">
                {String(h.after["code"] ?? h.after["name"])} · {h.action} ·{" "}
                {new Date(h.date).toLocaleString("pt-BR", { timeZone: "America/Fortaleza" })}
              </p>
              <p>{h.reason}</p>
              {h.before && (
                <ul className="mt-2 space-y-1 text-muted-foreground">
                  {Object.entries(h.after)
                    .filter(([k, v]) => k !== "version" && k !== "id" && h.before?.[k] !== v)
                    .map(([k, v]) => (
                      <li key={k} className="break-words">
                        {(
                          {
                            name: "Nome",
                            price: "Preço",
                            phone: "WhatsApp",
                            supplierSku: "SKU fornecedor",
                            email: "E-mail",
                            active: "Situação",
                            priceSource: "Fonte do preço",
                          } as Record<string, string>
                        )[k] ?? k}
                        : {label(h.before?.[k])} → {label(v)}
                      </li>
                    ))}
                </ul>
              )}
              <p className="mt-2 text-xs text-muted-foreground">Responsável: {h.actor}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function SupplierCatalog({
  supplier,
  onEditSupplier,
  onSavedOrder,
}: {
  supplier: SupplierProfile;
  onEditSupplier: () => void;
  onSavedOrder: (id: string) => void;
}) {
  const query = useInventory<SupplierCatalogItem[]>(`vendor-catalog?supplierId=${supplier.id}`);
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("all");
  const [selected, setSelected] = useState<Record<string, OrderSelection>>({});
  const [editing, setEditing] = useState<{ item: SupplierCatalogItem | null } | null>(null);
  const [review, setReview] = useState<OrderSelection[] | null>(null);
  const [history, setHistory] = useState(false);
  const selection = Object.values(selected);
  const subtotal = selection.reduce(
    (sum, { item, quantity }) => sum + cents(item.price!) * BigInt(quantity),
    0n,
  );
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
  const term = search.toLocaleLowerCase("pt-BR").trim();
  const visible = query.data.filter(
    (i) =>
      (kind === "all" || i.kind === kind || (kind === "pending" && i.price === null)) &&
      `${i.code} ${i.supplierSku ?? ""} ${i.name}`.toLocaleLowerCase("pt-BR").includes(term),
  );
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-lg font-semibold">
          {supplier.name}{" "}
          <span className="text-sm font-normal text-muted-foreground">
            · {query.data.length} itens
          </span>
        </h2>
        <Button variant="outline" onClick={onEditSupplier}>
          Editar fornecedor
        </Button>
        <Button variant="outline" onClick={() => setHistory(!history)}>
          Histórico do fornecedor
        </Button>
        <Button disabled={!supplier.active} onClick={() => setEditing({ item: null })}>
          Novo item
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        WhatsApp: {supplier.phone ? `+${supplier.phone}` : "Não cadastrado"}
        {supplier.email ? ` · ${supplier.email}` : ""}
        {!supplier.active ? " · Fornecedor inativo" : ""}
      </p>
      {history && <SupplierHistory supplierId={supplier.id} onClose={() => setHistory(false)} />}
      {review ? (
        <SupplierCheckout
          supplier={supplier}
          selection={review}
          onClose={() => setReview(null)}
          onSaved={(id) => {
            setSelected({});
            setReview(null);
            onSavedOrder(id);
          }}
        />
      ) : (
        <>
          <div className="rounded-lg border bg-muted/30 p-4 text-sm leading-relaxed">
            Marque os itens e informe a quantidade de apresentações comerciais (box, frasco, kit ou
            conjunto). O número de boxes físicos aparece quando informado na embalagem. Códigos
            importados são internos; preencha o SKU oficial ao confirmar com o fornecedor. Consulte
            a edição e a fonte do preço em cada item. Valores sujeitos à confirmação. Itens com
            preço pendente precisam ser editados antes da seleção.
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <label className="flex-1">
              <span className="sr-only">Buscar no catálogo</span>
              <Input
                placeholder="Buscar produto, código ou SKU…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <label>
              <span className="sr-only">Tipo do catálogo</span>
              <select
                className="h-10 rounded-md border bg-background px-3"
                value={kind}
                onChange={(e) => setKind(e.target.value)}
              >
                <option value="all">Todos os itens</option>
                <option value="PRODUCT">Produtos</option>
                <option value="KIT">Kits / protocolos</option>
                <option value="ADDON">Adicionais</option>
                <option value="pending">Preço pendente</option>
              </select>
            </label>
          </div>
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full min-w-[850px] text-sm">
              <thead className="bg-muted/40 text-left">
                <tr>
                  {[
                    "Selecionar",
                    "Produto / código",
                    "Apresentação",
                    "Preço / apresentação",
                    "Quantidade",
                    "Subtotal",
                    "Cadastro",
                  ].map((h) => (
                    <th key={h} className="p-3 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((item) => {
                  const chosen = selected[item.id];
                  return (
                    <tr key={item.id} className="border-t align-top">
                      <td className="p-3">
                        <input
                          type="checkbox"
                          aria-label={`Selecionar ${item.code}`}
                          checked={Boolean(chosen)}
                          disabled={
                            !supplier.active ||
                            !item.active ||
                            item.price === null ||
                            (selection.length >= 50 && !chosen)
                          }
                          onChange={(e) =>
                            setSelected((current) => {
                              const next = { ...current };
                              if (e.target.checked) next[item.id] = { item, quantity: 1 };
                              else delete next[item.id];
                              return next;
                            })
                          }
                        />
                      </td>
                      <td className="max-w-xs p-3">
                        <p className="font-medium">{item.name}</p>
                        <p className="mt-1 font-mono text-xs text-muted-foreground">
                          {item.code}
                          {item.supplierSku
                            ? ` · SKU: ${item.supplierSku}`
                            : " · SKU oficial não informado"}
                        </p>
                        {!item.active && <Badge variant="secondary">Inativo</Badge>}
                        {item.description.includes("Pendência de cadastro:") && (
                          <Badge variant="secondary">Conferir cadastro</Badge>
                        )}
                        <details className="mt-2 text-xs text-muted-foreground">
                          <summary className="cursor-pointer">Ver composição e fonte</summary>
                          <p className="mt-2 whitespace-pre-wrap break-words">{item.description}</p>
                          <p className="mt-2">
                            {item.priceSource}
                            {item.sourcePage ? ` · página ${item.sourcePage}` : ""}
                          </p>
                          {item.pricingNote && <p className="mt-2">{item.pricingNote}</p>}
                        </details>
                      </td>
                      <td className="max-w-40 p-3">
                        <p>{item.packaging}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{item.contents}</p>
                        {item.boxesPerPack !== null && (
                          <p className="mt-1 text-xs">
                            {item.boxesPerPack} box(es) por apresentação
                          </p>
                        )}
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        {item.price === null ? (
                          <Badge variant="secondary">Preço pendente</Badge>
                        ) : (
                          money(item.price)
                        )}
                      </td>
                      <td className="p-3">
                        <Input
                          className="w-24"
                          aria-label={`Quantidade de apresentações ${item.code}`}
                          type="number"
                          min="1"
                          max="9999"
                          step="1"
                          disabled={!chosen}
                          value={chosen?.quantity ?? 1}
                          onChange={(e) => {
                            const n = Number(e.target.value);
                            if (Number.isInteger(n) && n >= 1 && n <= 9999)
                              setSelected((c) => ({
                                ...c,
                                [item.id]: { ...c[item.id]!, quantity: n },
                              }));
                          }}
                        />
                        {chosen && item.boxesPerPack !== null && (
                          <p className="mt-1 text-xs">
                            {chosen.quantity * item.boxesPerPack} boxes físicos
                          </p>
                        )}
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        {chosen
                          ? money(decimalMoney(cents(chosen.item.price!) * BigInt(chosen.quantity)))
                          : "—"}
                      </td>
                      <td className="p-3">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={!supplier.active}
                          onClick={() => setEditing({ item })}
                          aria-label={`Editar ${item.code}`}
                        >
                          Editar
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!visible.length && <p className="p-5 text-sm">Nenhum item encontrado.</p>}
          </div>
          <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4 shadow-sm">
            <p className="mr-auto text-sm">
              {selection.length} itens selecionados · Subtotal{" "}
              <strong>{money(decimalMoney(subtotal))}</strong>
            </p>
            <Button
              variant="outline"
              onClick={() => {
                setSelected({});
                void query.refetch();
              }}
              disabled={!selection.length}
            >
              Limpar seleção e atualizar
            </Button>
            <Button
              disabled={!supplier.active || !selection.length}
              onClick={() => setReview(selection)}
            >
              Revisar pedido
            </Button>
          </div>
        </>
      )}
      {editing && (
        <SupplierForm
          kind="item"
          supplier={supplier}
          item={editing.item}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setSelected({});
          }}
        />
      )}
    </div>
  );
}

export function SupplierPage() {
  const suppliers = useInventory<SupplierProfile[]>("vendors");
  const orders =
    useInventory<(SupplierOrder & { status: "OPEN" | "PARTIAL" | "RECEIVED" })[]>("vendor-orders");
  const [supplierId, setSupplierId] = useState("");
  const [editing, setEditing] = useState<{ supplier: SupplierProfile | null } | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  if (suppliers.isPending || orders.isPending) return <InventoryState pending />;
  if (suppliers.error || orders.error)
    return (
      <InventoryState
        error={suppliers.error ?? orders.error}
        retry={() => {
          void suppliers.refetch();
          void orders.refetch();
        }}
      />
    );
  const supplier =
    suppliers.data.find((s) => s.id === supplierId) ??
    suppliers.data.find((s) => s.name.toLowerCase() === "essentia") ??
    suppliers.data[0];
  return (
    <div className="space-y-7">
      <SectionHeader
        eyebrow="Estoque · Compras"
        title="Fazer compra"
        description="Selecione produtos, confira o custo e prepare o pedido ao fornecedor."
        action={<Button onClick={() => setEditing({ supplier: null })}>Novo fornecedor</Button>}
      />
      <label className="block max-w-md space-y-1">
        <span>Fornecedor do catálogo</span>
        <select
          className="h-10 w-full rounded-md border bg-background px-3"
          value={supplier?.id ?? ""}
          onChange={(e) => {
            setSupplierId(e.target.value);
            setSavedId(null);
          }}
        >
          {suppliers.data.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.active ? "" : " (inativo)"}
            </option>
          ))}
        </select>
      </label>
      {savedId && <SavedSupplierOrder id={savedId} onClose={() => setSavedId(null)} />}
      {supplier ? (
        <SupplierCatalog
          key={supplier.id}
          supplier={supplier}
          onEditSupplier={() => setEditing({ supplier })}
          onSavedOrder={setSavedId}
        />
      ) : (
        <p className="text-sm">Cadastre um fornecedor para começar.</p>
      )}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Pedidos preparados</h2>
        <p className="text-sm text-muted-foreground">
          Últimos 100 pedidos. Envio e confirmação são feitos com o fornecedor; recebimento atualiza
          o estoque.
        </p>
        {orders.data.length ? (
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full min-w-[600px] text-sm">
              <thead className="text-left">
                <tr>
                  {["Pedido", "Fornecedor", "Total estimado", "Recebimento", "Lista"].map((s) => (
                    <th key={s} className="p-3">
                      {s}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {orders.data.map((o) => (
                  <tr key={o.id} className="border-t">
                    <td className="p-3">{o.reference}</td>
                    <td className="p-3">{o.supplier.name}</td>
                    <td className="p-3">{money(o.total)}</td>
                    <td className="p-3">
                      {{ OPEN: "Pendente", PARTIAL: "Parcial", RECEIVED: "Recebido" }[o.status]}
                    </td>
                    <td className="p-3">
                      <Button
                        variant="ghost"
                        onClick={() => setSavedId(o.id)}
                        aria-label={`Abrir pedido ${o.reference}`}
                      >
                        Abrir / exportar
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Nenhum pedido preparado ainda.</p>
        )}
      </section>
      {editing && (
        <SupplierForm
          kind="supplier"
          supplier={editing.supplier}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
        />
      )}
    </div>
  );
}
