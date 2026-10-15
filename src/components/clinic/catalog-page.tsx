import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useInventory } from "@/data/inventory-api";
import type {
  CatalogProduct,
  CatalogLocation,
  CatalogSnapshot,
  CatalogChange,
} from "@/data/catalog-input";
import { CatalogForm } from "./catalog-form";
import { InventoryState } from "./inventory-state";
import { SectionHeader } from "./section-header";

const amount = (value: string) =>
  new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(Number(value));
const labels = {
  name: "Nome",
  sku: "SKU",
  category: "Categoria",
  unit: "Unidade",
  minimum: "Estoque mínimo",
  active: "Situação",
};
function valueText(value: unknown, key: string) {
  if (key === "active") return value ? "Ativo" : "Inativo";
  if (key === "minimum") return amount(String(value));
  return String(value);
}

function CatalogHistory({
  kind,
  item,
  onClose,
}: {
  kind: "products" | "locations";
  item: CatalogSnapshot;
  onClose: () => void;
}) {
  const query = useInventory<CatalogChange[]>(
    `catalog/history?resource=${kind === "products" ? "PRODUCT" : "LOCATION"}&itemId=${item.id}`,
  );
  return (
    <section
      aria-label={`Histórico de ${item.name}`}
      className="space-y-4 rounded-xl border bg-card p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Histórico de {item.name}</h2>
          <p className="text-xs text-muted-foreground">Últimas 50 alterações do cadastro.</p>
        </div>
        <Button variant="ghost" onClick={onClose}>
          Fechar histórico
        </Button>
      </div>
      {query.isPending ? (
        <InventoryState pending />
      ) : query.error ? (
        <InventoryState
          error={query.error}
          retry={() => {
            void query.refetch();
          }}
        />
      ) : !query.data.length ? (
        <p className="text-sm text-muted-foreground">
          Nenhuma alteração registrada nesta etapa para este cadastro.
        </p>
      ) : (
        <ol className="space-y-3">
          {query.data.map((change) => {
            const after = change.after as unknown as Record<string, unknown>;
            const before = change.before as unknown as Record<string, unknown> | null;
            return (
              <li key={change.id} className="rounded-md border p-4 text-sm">
                <p className="font-medium">
                  {change.action === "CREATE" ? "Cadastro criado" : "Cadastro alterado"} ·{" "}
                  {new Date(change.date).toLocaleString("pt-BR", { timeZone: "America/Fortaleza" })}
                </p>
                <p className="mt-1">{change.reason}</p>
                <ul className="mt-2 space-y-1 text-muted-foreground">
                  {Object.entries(labels)
                    .filter(([key]) => key in after && (!before || before[key] !== after[key]))
                    .map(([key, label]) => (
                      <li key={key}>
                        {label}: {before ? `${valueText(before[key], key)} → ` : ""}
                        {valueText(after[key], key)}
                      </li>
                    ))}
                </ul>
                <p className="mt-2 text-xs text-muted-foreground">Responsável: {change.actor}</p>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

type Selection = { kind: "products" | "locations"; item: CatalogSnapshot | null };
export function CatalogPage() {
  const products = useInventory<CatalogProduct[]>("catalog/products");
  const locations = useInventory<CatalogLocation[]>("catalog/locations");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [editing, setEditing] = useState<Selection | null>(null);
  const [history, setHistory] = useState<(Selection & { item: CatalogSnapshot }) | null>(null);
  const [message, setMessage] = useState("");
  if (products.isPending || locations.isPending) return <InventoryState pending />;
  if (products.error || locations.error)
    return (
      <InventoryState
        error={products.error ?? locations.error}
        retry={() => {
          void products.refetch();
          void locations.refetch();
        }}
      />
    );
  const term = search.toLocaleLowerCase("pt-BR").trim();
  const matches = (item: CatalogSnapshot) =>
    (status === "all" || item.active === (status === "active")) &&
    `${item.name} ${"sku" in item ? `${item.sku} ${item.category}` : ""}`
      .toLocaleLowerCase("pt-BR")
      .includes(term);
  const visibleProducts = products.data.filter(matches);
  const visibleLocations = locations.data.filter(matches);
  const edit = (kind: Selection["kind"], item: CatalogSnapshot | null) => {
    setMessage("");
    setEditing({ kind, item });
  };
  return (
    <div className="space-y-7">
      <SectionHeader
        eyebrow="Estoque · Cadastros"
        title="Produtos e sede"
        description="Cadastre itens e locais, mantenha o mínimo de reposição e acompanhe as alterações."
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => edit("locations", null)}>
              Novo local
            </Button>
            <Button onClick={() => edit("products", null)}>Novo produto</Button>
          </div>
        }
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="outline">
          <Link to="/estoque">Voltar ao estoque</Link>
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            void products.refetch();
            void locations.refetch();
          }}
        >
          Atualizar cadastros
        </Button>
      </div>
      {message && (
        <p role="status" className="rounded-md border bg-card p-3 text-sm">
          {message}
        </p>
      )}
      <div className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-[1fr_auto]">
        <label className="space-y-1">
          <span className="text-sm">Buscar cadastros</span>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Nome, SKU ou categoria"
          />
        </label>
        <label className="space-y-1">
          <span className="text-sm">Situação dos cadastros</span>
          <select
            className="block h-9 w-full rounded-md border bg-background px-3 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="all">Todos</option>
            <option value="active">Ativos</option>
            <option value="inactive">Inativos</option>
          </select>
        </label>
      </div>
      <section
        aria-label="Produtos cadastrados"
        className="overflow-hidden rounded-xl border bg-card shadow-soft"
      >
        <h2 className="border-b px-5 py-4 font-semibold">Produtos · {visibleProducts.length}</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                {["Produto / SKU", "Categoria", "Unidade", "Mínimo", "Situação", "Ações"].map(
                  (label) => (
                    <th scope="col" key={label} className="px-4 py-3">
                      {label}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {!visibleProducts.length ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-muted-foreground">
                    Nenhum produto encontrado.
                  </td>
                </tr>
              ) : (
                visibleProducts.map((item) => (
                  <tr key={item.id} className="border-t">
                    <td className="px-4 py-3">
                      <Link
                        className="font-medium underline-offset-4 hover:underline"
                        to="/estoque/produtos/$productId"
                        params={{ productId: item.id }}
                      >
                        {item.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">{item.sku}</p>
                    </td>
                    <td className="px-4 py-3">{item.category}</td>
                    <td className="px-4 py-3">{item.unit}</td>
                    <td className="px-4 py-3">{amount(item.minimum)}</td>
                    <td className="px-4 py-3">
                      <Badge variant="outline">{item.active ? "Ativo" : "Inativo"}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Editar produto ${item.name}`}
                          onClick={() => edit("products", item)}
                        >
                          Editar
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Histórico do produto ${item.name}`}
                          onClick={() => setHistory({ kind: "products", item })}
                        >
                          Histórico
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
      <section
        aria-label="Locais cadastrados"
        className="overflow-hidden rounded-xl border bg-card shadow-soft"
      >
        <h2 className="border-b px-5 py-4 font-semibold">Locais · {visibleLocations.length}</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                {["Local", "Situação", "Ações"].map((label) => (
                  <th scope="col" key={label} className="px-4 py-3">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!visibleLocations.length ? (
                <tr>
                  <td colSpan={3} className="p-8 text-center text-muted-foreground">
                    Nenhum local encontrado.
                  </td>
                </tr>
              ) : (
                visibleLocations.map((item) => (
                  <tr key={item.id} className="border-t">
                    <td className="px-4 py-3 font-medium">{item.name}</td>
                    <td className="px-4 py-3">
                      <Badge variant="outline">{item.active ? "Ativo" : "Inativo"}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Editar local ${item.name}`}
                          onClick={() => edit("locations", item)}
                        >
                          Editar
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Histórico do local ${item.name}`}
                          onClick={() => setHistory({ kind: "locations", item })}
                        >
                          Histórico
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
      {history && (
        <CatalogHistory kind={history.kind} item={history.item} onClose={() => setHistory(null)} />
      )}
      {editing && (
        <CatalogForm
          key={`${editing.kind}-${editing.item?.id ?? "new"}`}
          kind={editing.kind}
          initial={editing.item}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setMessage(
              `${editing.kind === "products" ? "Produto" : "Local"} ${editing.item ? "atualizado" : "cadastrado"}.`,
            );
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
