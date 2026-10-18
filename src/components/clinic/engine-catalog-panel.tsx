import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useInventory, readInventoryResponse } from "@/data/inventory-api";
import { withSelectedUnit } from "@/data/unit-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InventoryState } from "./inventory-state";

import type {
  EngineCatalogItem as Item,
  EngineActiveLink as ActiveLink,
  EngineCommercialMapping as Mapping,
  EngineUnitPrice as Price,
  EngineCatalogPayload as Snapshot,
} from "@/data/engine-catalog";

const kindNames = {
  ACTIVE: "Ativo",
  MEDICATION: "Medicamento",
  SERVICE: "Serviço",
  PROCEDURE: "Procedimento",
};
const selectClass = "mt-1 h-10 w-full min-w-0 rounded-lg border bg-white px-2 text-sm";
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const today = () => new Date().toISOString().slice(0, 10);
function catalogPriceLabel(price: Price, referenceDate: string) {
  const reference = referenceDate.slice(0, 10);
  const start = price.validFrom.slice(0, 10);
  const end = price.validUntil?.slice(0, 10);
  if (
    !price.active ||
    price.effectiveAvailability !== "AVAILABLE" ||
    price.availability !== "AVAILABLE" ||
    !reference ||
    !start ||
    start > reference ||
    (end && end < reference) ||
    !Number.isFinite(Number(price.amount)) ||
    Number(price.amount) <= 0
  )
    return "Preço indisponível";
  return `${money.format(Number(price.amount))} / ${price.sellingUnit}`;
}
export function EngineCatalogPanel() {
  const fieldId = useId();
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [tab, setTab] = useState<"items" | "links" | "prices">("items");
  const query = useInventory<Snapshot>(
    `engine-catalog?search=${encodeURIComponent(search)}&limit=100&offset=${offset}`,
  );
  const [item, setItem] = useState<Item | null>(null);
  const [link, setLink] = useState<ActiveLink | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [price, setPrice] = useState<Price | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const lock = useRef(false);
  const operation = useRef<{ key: string; id: string } | null>(null);
  useEffect(() => {
    function resetScope() {
      setItem(null);
      setLink(null);
      setMapping(null);
      setPrice(null);
      setError("");
      setMessage("");
      setOffset(0);
      operation.current = null;
    }
    window.addEventListener("inventory-unit-change", resetScope);
    return () => window.removeEventListener("inventory-unit-change", resetScope);
  }, []);
  async function save(event: FormEvent, action: string, body: object) {
    event.preventDefault();
    if (lock.current) return;
    const key = JSON.stringify({ action, ...body });
    if (operation.current?.key !== key) operation.current = { key, id: crypto.randomUUID() };
    lock.current = true;
    setPending(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(withSelectedUnit("/api/v1/inventory/engine-catalog"), {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...body, operationId: operation.current.id }),
      });
      await readInventoryResponse(response, "Não foi possível salvar o catálogo.");
      operation.current = null;
      setItem(null);
      setLink(null);
      setMapping(null);
      setPrice(null);
      await query.refetch();
      setMessage("Cadastro salvo. Nenhuma cobrança ou movimentação de estoque foi criada.");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Falha de conexão. Tente novamente mantendo os dados para repetir a mesma operação.",
      );
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  if (query.isPending || query.error)
    return (
      <InventoryState pending={query.isPending} error={query.error} retry={() => query.refetch()} />
    );
  const data = query.data!;
  const itemName = (id: string | null) =>
    data.items.find((entry) => entry.id === id)?.name ??
    `Item fora desta página (${id ?? "sem referência"})`;
  const productName = (id: string | null) => {
    const entry = data.products.find((value) => value.id === id);
    return entry
      ? `${entry.name} · ${entry.sku}`
      : `SKU fora desta página (${id ?? "sem referência"})`;
  };
  const targetName = (value: { productId: string | null; catalogItemId: string | null }) =>
    value.productId ? productName(value.productId) : itemName(value.catalogItemId);
  const activeItems = data.items.filter((entry) => entry.active);
  const targets = activeItems.filter(
    (entry) => entry.kind === "SERVICE" || entry.kind === "PROCEDURE",
  );
  function newItem() {
    setItem({
      id: crypto.randomUUID(),
      kind: "ACTIVE",
      name: "",
      description: "",
      category: "",
      unit: "",
      presentation: null,
      concentration: null,
      internalCode: null,
      supplierId: null,
      active: true,
      version: 0,
    });
  }
  return (
    <div className="space-y-5">
      <p className="rounded-xl border border-teal-200 bg-teal-50 p-3 text-sm text-teal-950">
        Catálogo clínico e comercial separado da prescrição. Vínculos são explícitos; cadastrar,
        mapear ou informar preços não prescreve, cobra nem movimenta estoque.
      </p>
      <label className="block max-w-xl text-sm">
        Buscar no catálogo
        <Input
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setOffset(0);
          }}
          placeholder="Nome do ativo, medicamento, serviço ou SKU"
        />
      </label>
      <div role="tablist" aria-label="Seções do catálogo" className="flex flex-wrap gap-2">
        {(
          [
            ["items", "Ativos e serviços"],
            ["links", "Vínculos"],
            ["prices", "Preços por unidade"],
          ] as const
        ).map(([key, label]) => (
          <Button
            key={key}
            role="tab"
            aria-selected={tab === key}
            variant={tab === key ? "default" : "outline"}
            className={tab === key ? "bg-teal-800 hover:bg-teal-900" : ""}
            onClick={() => setTab(key)}
          >
            {label}
          </Button>
        ))}
      </div>
      {error && (
        <p role="alert" className="rounded-lg border border-red-200 p-3 text-red-700">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="rounded-lg border p-3 text-sm">
          {message}
        </p>
      )}
      {tab === "items" && (
        <section
          className="space-y-4 rounded-xl border bg-white p-4"
          aria-label="Ativos e serviços"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-teal-950">
              Ativos, medicamentos, serviços e procedimentos
            </h2>
            {data.canManageCatalog === true && (
              <Button disabled={pending} onClick={newItem}>
                Novo item
              </Button>
            )}
          </div>
          {item && data.canManageCatalog === true && (
            <form
              className="space-y-3 rounded-xl border border-teal-200 bg-teal-50 p-4"
              onSubmit={(event) =>
                void save(event, "SAVE_ITEM", { ...item, version: item.version || null })
              }
            >
              <fieldset disabled={pending} className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor={`${fieldId}-item-kind`}> Tipo do item</label>
                  <select
                    id={`${fieldId}-item-kind`}
                    className={selectClass}
                    disabled={item.version > 0}
                    value={item.kind}
                    onChange={(event) =>
                      setItem({ ...item, kind: event.target.value as Item["kind"] })
                    }
                  >
                    {Object.entries(kindNames).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <label>
                  Nome do item
                  <Input
                    required
                    maxLength={160}
                    value={item.name}
                    onChange={(event) => setItem({ ...item, name: event.target.value })}
                  />
                </label>
                {(
                  [
                    ["category", "Categoria", 100],
                    ["unit", "Unidade do item", 80],
                    ["presentation", "Apresentação do item", 160],
                    ["concentration", "Concentração informada", 160],
                    ["internalCode", "Código interno", 100],
                  ] as const
                ).map(([key, label, max]) => (
                  <label key={key}>
                    {label}
                    <Input
                      maxLength={max}
                      value={item[key] ?? ""}
                      onChange={(event) => setItem({ ...item, [key]: event.target.value })}
                    />
                  </label>
                ))}
                <div>
                  <label htmlFor={`${fieldId}-item-supplier`}> Fornecedor do item</label>
                  <select
                    id={`${fieldId}-item-supplier`}
                    className={selectClass}
                    value={item.supplierId ?? ""}
                    onChange={(event) =>
                      setItem({ ...item, supplierId: event.target.value || null })
                    }
                  >
                    <option value="">Sem fornecedor informado</option>
                    {data.suppliers.map((supplier) => (
                      <option key={supplier.id} value={supplier.id}>
                        {supplier.name}
                      </option>
                    ))}
                  </select>
                </div>
                <label className="sm:col-span-2">
                  Descrição do item
                  <textarea
                    className="mt-1 min-h-20 w-full rounded-lg border p-2"
                    maxLength={2000}
                    value={item.description}
                    onChange={(event) => setItem({ ...item, description: event.target.value })}
                  />
                </label>
                <label className="flex gap-2">
                  <input
                    type="checkbox"
                    checked={item.active}
                    onChange={(event) => setItem({ ...item, active: event.target.checked })}
                  />
                  Item ativo (desmarque para arquivar)
                </label>
                <div className="flex gap-2">
                  <Button type="submit">Salvar item</Button>
                  <Button type="button" variant="outline" onClick={() => setItem(null)}>
                    Cancelar item
                  </Button>
                </div>
              </fieldset>
            </form>
          )}
          <ul className="divide-y">
            {data.items.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div>
                  <h3 className="font-medium">{entry.name}</h3>
                  <p className="text-xs text-muted-foreground">
                    {kindNames[entry.kind]} · {entry.active ? "Ativo" : "Arquivado"} · v
                    {entry.version}
                  </p>
                  {entry.description && <p className="mt-1 text-sm">{entry.description}</p>}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {[
                      entry.category,
                      entry.unit,
                      entry.presentation,
                      entry.concentration,
                      entry.internalCode,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                {data.canManageCatalog === true && (
                  <Button
                    variant="outline"
                    disabled={pending}
                    onClick={() => setItem({ ...entry })}
                    aria-label={`Editar ${entry.name}`}
                  >
                    Editar
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {!data.items.length && (
            <p className="text-sm text-muted-foreground">Nenhum item nesta página.</p>
          )}
        </section>
      )}
      {tab === "links" && (
        <section
          className="space-y-5 rounded-xl border bg-white p-4"
          aria-label="Vínculos do catálogo"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-teal-950">Ativos de cada SKU</h2>
            {data.canManageCatalog === true && (
              <Button
                disabled={pending}
                onClick={() =>
                  setLink({
                    id: crypto.randomUUID(),
                    productId: "",
                    activeItemId: "",
                    active: true,
                    version: 0,
                  })
                }
              >
                Vincular ativo ao SKU
              </Button>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            Um SKU pode ter vários ativos. Nomes semelhantes não criam vínculos automaticamente.
          </p>
          {link && data.canManageCatalog === true && (
            <form
              onSubmit={(event) =>
                void save(event, "LINK_ACTIVE", { ...link, version: link.version || null })
              }
            >
              <fieldset
                disabled={pending}
                className="grid gap-3 rounded-xl border bg-teal-50 p-3 sm:grid-cols-2"
              >
                <div>
                  <label htmlFor={`${fieldId}-link-sku`}> SKU do vínculo</label>
                  <select
                    id={`${fieldId}-link-sku`}
                    required
                    className={selectClass}
                    disabled={link.version > 0}
                    value={link.productId}
                    onChange={(event) => setLink({ ...link, productId: event.target.value })}
                  >
                    <option value="">Selecionar SKU</option>
                    {data.products.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name} · {entry.sku}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor={`${fieldId}-link-active`}> Ativo do SKU</label>
                  <select
                    id={`${fieldId}-link-active`}
                    required
                    className={selectClass}
                    disabled={link.version > 0}
                    value={link.activeItemId}
                    onChange={(event) => setLink({ ...link, activeItemId: event.target.value })}
                  >
                    <option value="">Selecionar ativo</option>
                    {activeItems
                      .filter((entry) => entry.kind === "ACTIVE")
                      .map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.name}
                        </option>
                      ))}
                  </select>
                </div>
                <label className="flex gap-2">
                  <input
                    type="checkbox"
                    checked={link.active}
                    onChange={(event) => setLink({ ...link, active: event.target.checked })}
                  />
                  Vínculo ativo
                </label>
                <div className="flex gap-2">
                  <Button type="submit">Salvar vínculo</Button>
                  <Button type="button" variant="outline" onClick={() => setLink(null)}>
                    Cancelar vínculo
                  </Button>
                </div>
              </fieldset>
            </form>
          )}
          <ul className="divide-y">
            {data.links.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <p>
                  {productName(entry.productId)} → {itemName(entry.activeItemId)} ·{" "}
                  {entry.active ? "Ativo" : "Inativo"}
                </p>
                {data.canManageCatalog === true && (
                  <Button
                    variant="outline"
                    disabled={pending}
                    onClick={() => setLink({ ...entry })}
                  >
                    Editar vínculo
                  </Button>
                )}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
            <h2 className="font-semibold text-teal-950">Mapeamentos comerciais e insumos</h2>
            {data.canManageCatalog === true && (
              <Button
                disabled={pending}
                onClick={() =>
                  setMapping({
                    id: crypto.randomUUID(),
                    sourceItemId: "",
                    targetProductId: null,
                    targetItemId: null,
                    billingMode: "SEPARATE",
                    chargeGroup: "",
                    active: true,
                    version: 0,
                  })
                }
              >
                Novo mapeamento
              </Button>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            Indique explicitamente se o insumo é cobrado separadamente ou já está incluído. O grupo
            de cobrança identifica a inclusão; não gera cobrança automática.
          </p>
          {mapping && data.canManageCatalog === true && (
            <form
              onSubmit={(event) =>
                void save(event, "SAVE_MAPPING", { ...mapping, version: mapping.version || null })
              }
            >
              <fieldset
                disabled={pending}
                className="grid gap-3 rounded-xl border bg-teal-50 p-3 sm:grid-cols-2"
              >
                <div>
                  <label htmlFor={`${fieldId}-mapping-source`}> Item de origem</label>
                  <select
                    id={`${fieldId}-mapping-source`}
                    required
                    className={selectClass}
                    disabled={mapping.version > 0}
                    value={mapping.sourceItemId}
                    onChange={(event) =>
                      setMapping({ ...mapping, sourceItemId: event.target.value })
                    }
                  >
                    <option value="">Selecionar item</option>
                    {activeItems.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor={`${fieldId}-mapping-target`}> Destino do mapeamento</label>
                  <select
                    id={`${fieldId}-mapping-target`}
                    required
                    className={selectClass}
                    disabled={mapping.version > 0}
                    value={
                      mapping.targetProductId
                        ? `SKU:${mapping.targetProductId}`
                        : mapping.targetItemId
                          ? `ITEM:${mapping.targetItemId}`
                          : ""
                    }
                    onChange={(event) => {
                      const [kind, id] = event.target.value.split(":");
                      setMapping({
                        ...mapping,
                        targetProductId: kind === "SKU" ? (id ?? null) : null,
                        targetItemId: kind === "ITEM" ? (id ?? null) : null,
                      });
                    }}
                  >
                    <option value="">Selecionar destino</option>
                    <optgroup label="SKU">
                      {data.products.map((entry) => (
                        <option key={entry.id} value={`SKU:${entry.id}`}>
                          {entry.name} · {entry.sku}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Serviço / procedimento">
                      {targets.map((entry) => (
                        <option key={entry.id} value={`ITEM:${entry.id}`}>
                          {entry.name}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                </div>
                <div>
                  <label htmlFor={`${fieldId}-mapping-billing`}> Modo de cobrança</label>
                  <select
                    id={`${fieldId}-mapping-billing`}
                    className={selectClass}
                    value={mapping.billingMode}
                    onChange={(event) =>
                      setMapping({
                        ...mapping,
                        billingMode: event.target.value as Mapping["billingMode"],
                      })
                    }
                  >
                    <option value="SEPARATE">Cobrado separadamente</option>
                    <option value="INCLUDED">Já incluído no grupo</option>
                  </select>
                </div>
                <label>
                  Grupo de cobrança
                  <Input
                    required
                    maxLength={100}
                    disabled={mapping.version > 0}
                    value={mapping.chargeGroup}
                    onChange={(event) =>
                      setMapping({ ...mapping, chargeGroup: event.target.value })
                    }
                  />
                </label>
                <label className="flex gap-2">
                  <input
                    type="checkbox"
                    checked={mapping.active}
                    onChange={(event) => setMapping({ ...mapping, active: event.target.checked })}
                  />
                  Mapeamento ativo
                </label>
                <div className="flex gap-2">
                  <Button type="submit">Salvar mapeamento</Button>
                  <Button type="button" variant="outline" onClick={() => setMapping(null)}>
                    Cancelar mapeamento
                  </Button>
                </div>
              </fieldset>
            </form>
          )}
          <ul className="divide-y">
            {data.mappings.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <p>
                  {itemName(entry.sourceItemId)} →{" "}
                  {entry.targetProductId
                    ? productName(entry.targetProductId)
                    : itemName(entry.targetItemId)}{" "}
                  · {entry.billingMode === "INCLUDED" ? "Incluído" : "Separado"} ·{" "}
                  {entry.chargeGroup} · {entry.active ? "Ativo" : "Inativo"}
                </p>
                {data.canManageCatalog === true && (
                  <Button
                    variant="outline"
                    disabled={pending}
                    onClick={() => setMapping({ ...entry })}
                  >
                    Editar mapeamento
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {tab === "prices" && (
        <section
          className="space-y-4 rounded-xl border bg-white p-4"
          aria-label="Preços por unidade"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-teal-950">Preços de venda por unidade</h2>
            {data.canManagePrices === true && (
              <Button
                disabled={pending}
                onClick={() =>
                  setPrice({
                    id: crypto.randomUUID(),
                    unitId: data.units.length === 1 ? data.units[0]!.id : "",
                    productId: null,
                    catalogItemId: null,
                    amount: "",
                    sellingUnit: "",
                    source: "",
                    validFrom: today(),
                    validUntil: null,
                    availability: "UNKNOWN",
                    active: true,
                    version: 0,
                    effectiveAvailability: "UNKNOWN",
                  })
                }
              >
                Novo preço
              </Button>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            Preço indisponível não equivale a zero. Informe moeda BRL, unidade de venda, origem e
            vigência; não há fallback para preços legados. Editar substitui o registro de preço
            atual do item na unidade, sem programar uma sequência de preços futuros.
          </p>
          {price && data.canManagePrices === true && (
            <form
              onSubmit={(event) => {
                const { effectiveAvailability: _status, ...body } = price;
                void save(event, "SET_UNIT_PRICE", { ...body, version: price.version || null });
              }}
            >
              <fieldset
                disabled={pending}
                className="grid gap-3 rounded-xl border bg-teal-50 p-3 sm:grid-cols-2"
              >
                <div>
                  <label htmlFor={`${fieldId}-price-unit`}> Unidade do preço</label>
                  <select
                    id={`${fieldId}-price-unit`}
                    required
                    className={selectClass}
                    disabled={price.version > 0}
                    value={price.unitId}
                    onChange={(event) => setPrice({ ...price, unitId: event.target.value })}
                  >
                    <option value="">Selecionar unidade</option>
                    {data.units.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor={`${fieldId}-price-target`}> Item precificado</label>
                  <select
                    id={`${fieldId}-price-target`}
                    required
                    className={selectClass}
                    disabled={price.version > 0}
                    value={
                      price.productId
                        ? `SKU:${price.productId}`
                        : price.catalogItemId
                          ? `ITEM:${price.catalogItemId}`
                          : ""
                    }
                    onChange={(event) => {
                      const [kind, id] = event.target.value.split(":");
                      setPrice({
                        ...price,
                        productId: kind === "SKU" ? (id ?? null) : null,
                        catalogItemId: kind === "ITEM" ? (id ?? null) : null,
                      });
                    }}
                  >
                    <option value="">Selecionar item</option>
                    <optgroup label="SKU">
                      {data.products.map((entry) => (
                        <option key={entry.id} value={`SKU:${entry.id}`}>
                          {entry.name} · {entry.sku}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Serviço / procedimento">
                      {targets.map((entry) => (
                        <option key={entry.id} value={`ITEM:${entry.id}`}>
                          {entry.name}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                </div>
                <label>
                  Preço de venda (BRL)
                  <Input
                    required
                    inputMode="decimal"
                    pattern="[0-9]+[.][0-9]{2}"
                    placeholder="120.00"
                    value={price.amount}
                    onChange={(event) => setPrice({ ...price, amount: event.target.value })}
                  />
                </label>
                <label>
                  Unidade de venda
                  <Input
                    required
                    maxLength={100}
                    value={price.sellingUnit}
                    onChange={(event) => setPrice({ ...price, sellingUnit: event.target.value })}
                  />
                </label>
                <label>
                  Origem do preço
                  <Input
                    required
                    maxLength={200}
                    value={price.source}
                    onChange={(event) => setPrice({ ...price, source: event.target.value })}
                  />
                </label>
                <div>
                  <label htmlFor={`${fieldId}-price-availability`}> Disponibilidade</label>
                  <select
                    id={`${fieldId}-price-availability`}
                    className={selectClass}
                    value={price.availability}
                    onChange={(event) =>
                      setPrice({
                        ...price,
                        availability: event.target.value as Price["availability"],
                      })
                    }
                  >
                    <option value="UNKNOWN">Não confirmada</option>
                    <option value="AVAILABLE">Disponível</option>
                    <option value="UNAVAILABLE">Indisponível</option>
                  </select>
                </div>
                <label>
                  Vigência inicial
                  <Input
                    required
                    type="date"
                    value={price.validFrom.slice(0, 10)}
                    onChange={(event) => setPrice({ ...price, validFrom: event.target.value })}
                  />
                </label>
                <label>
                  Vigência final (opcional)
                  <Input
                    type="date"
                    min={price.validFrom.slice(0, 10)}
                    value={price.validUntil?.slice(0, 10) ?? ""}
                    onChange={(event) =>
                      setPrice({ ...price, validUntil: event.target.value || null })
                    }
                  />
                </label>
                <label className="flex gap-2">
                  <input
                    type="checkbox"
                    checked={price.active}
                    onChange={(event) => setPrice({ ...price, active: event.target.checked })}
                  />
                  Preço ativo
                </label>
                <div className="flex gap-2">
                  <Button type="submit">Salvar preço</Button>
                  <Button type="button" variant="outline" onClick={() => setPrice(null)}>
                    Cancelar preço
                  </Button>
                </div>
              </fieldset>
            </form>
          )}
          <ul className="divide-y">
            {data.prices.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div>
                  <p className="font-medium">
                    {targetName(entry)} ·{" "}
                    {data.units.find((unit) => unit.id === entry.unitId)?.name ??
                      "Unidade não disponível"}
                  </p>
                  <p className="text-teal-950">{catalogPriceLabel(entry, data.referenceDate)}</p>
                  <p className="text-xs text-muted-foreground">
                    Origem: {entry.source} · Vigência: {entry.validFrom.slice(0, 10)} até{" "}
                    {entry.validUntil?.slice(0, 10) ?? "sem término"} · v{entry.version}
                  </p>
                </div>
                {data.canManagePrices === true && (
                  <Button
                    variant="outline"
                    disabled={pending}
                    onClick={() => setPrice({ ...entry })}
                  >
                    Editar preço
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {!data.prices.length && (
            <p className="rounded-xl border p-4 text-sm">
              Preço indisponível — nenhum preço cadastrado nesta página.
            </p>
          )}
        </section>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <p>
          Consulta limitada a {data.limit} registros por conjunto · página{" "}
          {Math.floor(offset / 100) + 1}. Referência: {data.referenceDate.slice(0, 10)}.
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={pending || offset === 0}
            onClick={() => setOffset(Math.max(0, offset - 100))}
          >
            Página anterior
          </Button>
          <Button
            variant="outline"
            disabled={
              pending ||
              Math.max(
                data.items.length,
                data.products.length,
                data.links.length,
                data.mappings.length,
                data.prices.length,
              ) < 100
            }
            onClick={() => setOffset(offset + 100)}
          >
            Próxima página
          </Button>
        </div>
      </div>
    </div>
  );
}
