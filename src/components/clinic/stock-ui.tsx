import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowDownToLine,
  Boxes,
  CalendarClock,
  ChevronRight,
  ClipboardList,
  Package,
  Plus,
  Search,
  SlidersHorizontal,
  Truck,
  Warehouse,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { applications, formatBRL } from "@/data/mock-stock";
import {
  formatExpiry,
  summarizeStock,
  useInventory,
  type InventoryPosition,
  type InventoryProduct,
  type InventoryMovement,
} from "@/data/inventory-api";
import { InventoryState } from "./inventory-state";

const statusClass: Record<string, string> = {
  Normal: "bg-success-soft text-success-foreground border-transparent",
  "Estoque baixo": "bg-warning-soft text-warning-foreground border-transparent",
  Crítico: "bg-danger-soft text-danger-foreground border-transparent",
  "Próximo do vencimento": "bg-warning-soft text-warning-foreground border-transparent",
  Bloqueado: "bg-muted text-muted-foreground border-transparent",
};

export function StockStatus({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={cn("font-medium", statusClass[status] ?? "")}>
      {status}
    </Badge>
  );
}

export function SectionHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {eyebrow}
        </p>
        <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          {title}
        </h1>
        {description && (
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}

export function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
  tone = "default",
}: {
  icon: typeof Boxes;
  label: string;
  value: string;
  detail: string;
  tone?: "default" | "warning" | "danger";
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-soft">
      <div className="flex items-start justify-between">
        <div
          className={cn(
            "flex size-10 items-center justify-center rounded-lg",
            tone === "danger"
              ? "bg-danger-soft text-danger-foreground"
              : tone === "warning"
                ? "bg-warning-soft text-warning-foreground"
                : "bg-info-soft text-info-foreground",
          )}
        >
          <Icon className="size-5" />
        </div>
      </div>
      <p className="mt-4 text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

export function StockFilters({
  searchPlaceholder = "Buscar produto, lote ou fornecedor",
  locations = [],
  onSearch,
  onLocation,
  onStatus,
}: {
  searchPlaceholder?: string;
  locations?: string[];
  onSearch?: (value: string) => void;
  onLocation?: (value: string) => void;
  onStatus?: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-soft lg:flex-row lg:items-center">
      <div className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="Buscar estoque"
          placeholder={searchPlaceholder}
          onChange={(e) => onSearch?.(e.target.value)}
          className="h-10 pl-9"
        />
      </div>
      <Select defaultValue="all" onValueChange={(value) => onLocation?.(value)}>
        <SelectTrigger aria-label="Localização" className="w-full lg:w-44">
          <SelectValue placeholder="Localização" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todas as localizações</SelectItem>
          {locations.map((location) => (
            <SelectItem key={location} value={location}>
              {location}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select defaultValue="all" onValueChange={(value) => onStatus?.(value)}>
        <SelectTrigger aria-label="Status" className="w-full lg:w-40">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos os status</SelectItem>
          <SelectItem value="low">Estoque baixo</SelectItem>
          <SelectItem value="critical">Sem saldo disponível</SelectItem>
          <SelectItem value="expiry">Próximo do vencimento</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

export function StockOverviewPage() {
  const query = useInventory<InventoryPosition[]>("stock");
  const locationQuery = useInventory<{ id: string; name: string }[]>("locations");
  const [search, setSearch] = useState("");
  const [location, setLocation] = useState("all");
  const [status, setStatus] = useState("all");
  if (query.isPending || locationQuery.isPending) return <InventoryState pending />;
  if (query.error || locationQuery.error)
    return (
      <InventoryState
        error={query.error ?? locationQuery.error}
        retry={() => {
          void query.refetch();
          void locationQuery.refetch();
        }}
      />
    );
  const positions = query.data ?? [];
  const allProducts = summarizeStock(positions);
  const selected = positions.filter(
    (p) =>
      (location === "all" || p.location === location) &&
      `${p.name} ${p.lot} ${p.supplier}`
        .toLocaleLowerCase("pt-BR")
        .includes(search.toLocaleLowerCase("pt-BR")),
  );
  const labels: Record<string, string> = {
    low: "Estoque baixo",
    critical: "Bloqueado",
    expiry: "Próximo do vencimento",
  };
  const stockProducts = summarizeStock(selected).filter(
    (p) => status === "all" || p.status === labels[status],
  );
  const totalValue = positions.reduce((sum, p) => sum + p.quantity * p.cost, 0);
  const low = allProducts.filter((p) => p.quantity < p.minimum).length;
  const expiry = new Set(
    positions
      .filter((p) => p.expiringSoon && p.quantity > 0 && p.status === "AVAILABLE")
      .map((p) => p.lotId),
  ).size;
  const blocked = new Set(
    positions.filter((p) => p.status !== "AVAILABLE" && p.quantity > 0).map((p) => p.lotId),
  ).size;
  return (
    <div className="space-y-7">
      <SectionHeader
        eyebrow="Operação · Inventário"
        title="Estoque"
        description="Dados persistidos no PostgreSQL · ambiente de demonstração com dados sintéticos."
        action={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link to="/estoque/movimentacoes">
                <ClipboardList />
                Movimentações
              </Link>
            </Button>
            <Button asChild>
              <Link to="/estoque/recebimento">
                <ArrowDownToLine />
                Receber compra
              </Link>
            </Button>
          </div>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={Boxes}
          label="Valor físico em estoque"
          value={formatBRL(totalValue)}
          detail="Inclui lotes bloqueados e vencidos"
        />
        <MetricCard
          icon={AlertTriangle}
          label="Abaixo do mínimo"
          value={`${low} itens`}
          detail="Requerem reposição"
          tone="warning"
        />
        <MetricCard
          icon={CalendarClock}
          label="Próximos do vencimento"
          value={`${expiry} lotes`}
          detail="Vencem nos próximos 30 dias"
          tone="warning"
        />
        <MetricCard
          icon={XCircle}
          label="Bloqueios / alertas"
          value={`${blocked} lotes`}
          detail="Revisar antes de movimentar"
          tone="danger"
        />
      </div>
      <StockFilters
        locations={(locationQuery.data ?? []).map((l) => l.name)}
        onSearch={setSearch}
        onLocation={setLocation}
        onStatus={setStatus}
      />
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-soft">
        <div className="flex flex-col gap-2 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold">Estoque por produto</h2>
            <p className="text-xs text-muted-foreground">
              Saldo não é editado diretamente; é derivado do ledger.
            </p>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link to="/estoque/movimentacoes">
              Ver ledger <ChevronRight />
            </Link>
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                {[
                  "Produto",
                  "Categoria",
                  "Localização",
                  "Disponível",
                  "Mínimo",
                  "Status",
                  "Lote / validade",
                  "Custo unit.",
                  "Valor",
                ].map((h) => (
                  <th key={h} className="px-5 py-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stockProducts.length === 0 && (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-muted-foreground">
                    Nenhum produto encontrado para estes filtros.
                  </td>
                </tr>
              )}
              {stockProducts.map((product) => (
                <tr
                  key={product.id}
                  className="border-t border-border transition-colors hover:bg-muted/20"
                >
                  <td className="px-5 py-4">
                    <Link
                      to="/estoque/produtos/$productId"
                      params={{ productId: product.id }}
                      className="font-medium hover:underline"
                    >
                      {product.name}
                    </Link>
                    <p className="mt-0.5 text-xs text-muted-foreground">{product.unit}</p>
                  </td>
                  <td className="px-5 py-4 text-muted-foreground">{product.category}</td>
                  <td className="px-5 py-4 text-muted-foreground">{product.location}</td>
                  <td className="px-5 py-4 font-semibold tabular-nums">{product.quantity}</td>
                  <td className="px-5 py-4 text-muted-foreground tabular-nums">
                    {product.minimum}
                  </td>
                  <td className="px-5 py-4">
                    <StockStatus status={product.status} />
                  </td>
                  <td className="px-5 py-4">
                    <span className="font-medium">{product.lot}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{product.expiry}</span>
                  </td>
                  <td className="px-5 py-4 text-right tabular-nums">{formatBRL(product.cost)}</td>
                  <td className="px-5 py-4 text-right font-medium tabular-nums">
                    {formatBRL(product.value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-5 shadow-soft lg:col-span-2">
          <div className="flex items-center gap-3">
            <Warehouse className="size-5 text-primary" />
            <div>
              <h2 className="font-semibold">Rastreabilidade</h2>
              <p className="text-xs text-muted-foreground">
                Fornecedor → compra → lote → estoque → aplicação → paciente
              </p>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-2 text-xs">
            {["Fornecedor", "Compra", "Lote", "Estoque", "Aplicação", "Paciente"].map((step, i) => (
              <span key={step} className="flex items-center gap-2">
                {i > 0 && <ChevronRight className="size-3 text-muted-foreground" />}
                <span className="rounded-full border border-border bg-muted/40 px-3 py-1.5">
                  {step}
                </span>
              </span>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-5 shadow-soft">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Regra operacional
          </p>
          <h3 className="mt-2 font-semibold">FEFO</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Na seleção de lote, priorizar o vencimento mais próximo entre lotes disponíveis.
          </p>
        </div>
      </div>
    </div>
  );
}

export function ProductDetailPage({ productId }: { productId: string }) {
  const productQuery = useInventory<InventoryProduct>(`products/${productId}`);
  const lotQuery = useInventory<InventoryPosition[]>(
    `lots?productId=${encodeURIComponent(productId)}`,
  );
  const movementQuery = useInventory<InventoryMovement[]>(
    `movements?productId=${encodeURIComponent(productId)}`,
  );
  if (productQuery.isPending || lotQuery.isPending || movementQuery.isPending)
    return <InventoryState pending />;
  if (productQuery.error || lotQuery.error || movementQuery.error)
    return (
      <InventoryState
        error={productQuery.error ?? lotQuery.error ?? movementQuery.error}
        retry={() => {
          void productQuery.refetch();
          void lotQuery.refetch();
          void movementQuery.refetch();
        }}
      />
    );
  const lots = (lotQuery.data ?? []).map((l) => ({
    ...l,
    id: l.id,
    expiry: formatExpiry(l.expiry),
  }));
  const summary = summarizeStock(lotQuery.data ?? [])[0];
  const product = {
    ...productQuery.data!,
    quantity: summary?.quantity ?? 0,
    cost: summary?.cost ?? 0,
    expiry: summary?.expiry ?? "—",
    lot: summary?.lot ?? "—",
    location: summary?.location ?? "Sem posição de estoque",
  };
  const movements = (movementQuery.data ?? []).map((m) => ({
    ...m,
    date: new Date(m.date).toLocaleString("pt-BR", { timeZone: "America/Fortaleza" }),
  }));
  const suppliers = [...new Set(lots.map((l) => l.supplier))];
  return (
    <div className="space-y-7">
      <SectionHeader
        eyebrow="Estoque · Produto"
        title={product.name}
        description={`${product.category} · ${product.unit} · ${product.location}`}
        action={
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link to="/estoque/movimentacoes">
                <ClipboardList />
                Movimentações
              </Link>
            </Button>
            <Button asChild>
              <Link to="/estoque/recebimento">
                <ArrowDownToLine />
                Receber
              </Link>
            </Button>
          </div>
        }
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard
          icon={Package}
          label="Disponível"
          value={String(product.quantity)}
          detail={`Mínimo ${product.minimum} ${product.unit}`}
          tone={product.quantity <= product.minimum ? "warning" : "default"}
        />
        <MetricCard
          icon={Truck}
          label="Custo unitário"
          value={formatBRL(product.cost)}
          detail="Custo histórico do lote"
        />
        <MetricCard
          icon={CalendarClock}
          label="Validade principal"
          value={product.expiry}
          detail={`Lote ${product.lot}`}
          tone="warning"
        />
      </div>
      <div className="grid gap-5 xl:grid-cols-[1.25fr_.75fr]">
        <div className="rounded-xl border border-border bg-card shadow-soft">
          <div className="border-b border-border px-5 py-4">
            <h2 className="font-semibold">Lotes</h2>
            <p className="text-xs text-muted-foreground">Seleção orientada por validade (FEFO).</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  {["Lote", "Validade", "Fornecedor", "Local", "Custo", "Quantidade", "Status"].map(
                    (h) => (
                      <th key={h} className="px-5 py-3 font-medium">
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {lots.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-muted-foreground">
                      Nenhum lote registrado.
                    </td>
                  </tr>
                )}
                {lots.map((lot) => (
                  <tr key={lot.id} className="border-t border-border">
                    <td className="px-5 py-4 font-medium">{lot.lot}</td>
                    <td className="px-5 py-4">{lot.expiry}</td>
                    <td className="px-5 py-4 text-muted-foreground">{lot.supplier}</td>
                    <td className="px-5 py-4 text-muted-foreground">{lot.location}</td>
                    <td className="px-5 py-4">{formatBRL(lot.cost)}</td>
                    <td className="px-5 py-4 font-semibold">{lot.quantity}</td>
                    <td className="px-5 py-4">
                      <Badge variant="outline">{lot.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-5 shadow-soft">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Fornecedores
          </p>
          <div className="mt-4 space-y-3">
            {suppliers.map((s) => (
              <div
                key={s}
                className="flex items-center justify-between rounded-lg border border-border p-3"
              >
                <span className="font-medium">{s}</span>
                <span className="text-xs text-muted-foreground">Origem do lote</span>
              </div>
            ))}
          </div>
          <div className="mt-5 rounded-lg bg-warning-soft p-3 text-sm text-warning-foreground">
            <div className="flex gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>
                Disponível considera apenas lotes válidos e liberados. Consulte os locais antes da
                reposição.
              </span>
            </div>
          </div>
        </div>
      </div>
      <div className="rounded-xl border border-border bg-card shadow-soft">
        <div className="border-b border-border px-5 py-4">
          <h2 className="font-semibold">Histórico de movimentações</h2>
          <p className="text-xs text-muted-foreground">Ledger imutável de referência do saldo.</p>
        </div>
        <div className="divide-y divide-border">
          {movements.length === 0 && (
            <p className="p-5 text-sm text-muted-foreground">Nenhuma movimentação registrada.</p>
          )}
          {movements.map((m) => (
            <div
              key={m.id}
              className="grid gap-2 px-5 py-4 md:grid-cols-[180px_1fr_120px_160px] md:items-center"
            >
              <div className="text-xs text-muted-foreground">{m.date}</div>
              <div>
                <p className="font-medium">{m.type}</p>
                <p className="text-xs text-muted-foreground">
                  {m.lot} · {m.reference}
                </p>
              </div>
              <div
                className={cn(
                  "font-semibold tabular-nums",
                  m.quantity < 0 ? "text-danger-foreground" : "text-success-foreground",
                )}
              >
                {m.quantity > 0 ? "+" : ""}
                {m.quantity}
              </div>
              <div className="text-xs text-muted-foreground">{m.responsible}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export { ReceivingPage } from "./receiving-page";

export function MovementsPage() {
  const [search, setSearch] = useState("");
  const [location, setLocation] = useState("all");
  const query = useInventory<InventoryMovement[]>("movements");
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
  const locations = [...new Set((query.data ?? []).map((m) => m.location))];
  const stockMovements = (query.data ?? [])
    .filter(
      (m) =>
        (location === "all" || m.location === location) &&
        `${m.product} ${m.lot} ${m.reference} ${m.responsible}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .map((m) => ({
      ...m,
      date: new Date(m.date).toLocaleString("pt-BR", { timeZone: "America/Fortaleza" }),
      origin: m.quantity > 0 ? "Origem registrada" : m.location,
      destination: m.quantity > 0 ? m.location : "Saída registrada",
    }));
  return (
    <div className="space-y-7">
      <SectionHeader
        eyebrow="Estoque · Ledger"
        title="Movimentações"
        description="Histórico auditável de todas as entradas, saídas, transferências e correções."
        action={
          <Button asChild>
            <Link to="/estoque">
              <Package />
              Estoque
            </Link>
          </Button>
        }
      />
      <StockFilters
        searchPlaceholder="Buscar produto, lote, referência ou responsável"
        locations={locations}
        onSearch={setSearch}
        onLocation={setLocation}
      />
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-soft">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                {[
                  "Data / hora",
                  "Tipo",
                  "Produto",
                  "Lote",
                  "Origem → destino",
                  "Qtd.",
                  "Localização",
                  "Responsável",
                  "Referência",
                ].map((h) => (
                  <th key={h} className="px-4 py-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stockMovements.length === 0 && (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-muted-foreground">
                    Nenhuma movimentação encontrada.
                  </td>
                </tr>
              )}
              {stockMovements.map((m) => (
                <tr key={m.id} className="border-t border-border hover:bg-muted/20">
                  <td className="px-4 py-4 text-xs text-muted-foreground">{m.date}</td>
                  <td className="px-4 py-4">
                    <Badge variant="outline">{m.type}</Badge>
                  </td>
                  <td className="px-4 py-4 font-medium">{m.product}</td>
                  <td className="px-4 py-4">{m.lot}</td>
                  <td className="px-4 py-4 text-xs text-muted-foreground">
                    {m.origin} → {m.destination}
                  </td>
                  <td
                    className={cn(
                      "px-4 py-4 font-semibold",
                      m.quantity < 0 ? "text-danger-foreground" : "text-success-foreground",
                    )}
                  >
                    {m.quantity > 0 ? "+" : ""}
                    {m.quantity}
                  </td>
                  <td className="px-4 py-4 text-xs">{m.location}</td>
                  <td className="px-4 py-4 text-xs">{m.responsible}</td>
                  <td className="px-4 py-4 text-xs text-muted-foreground">{m.reference}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function ApplicationsPage() {
  return (
    <div className="space-y-7">
      <SectionHeader
        eyebrow="Operação · Aplicações"
        title="Aplicações"
        description="Demonstração com registros fictícios. Aplicações reais serão habilitadas no Milestone 4."
        action={
          <Button asChild>
            <Link to="/aplicacoes/nova">
              <Plus />
              Nova aplicação
            </Link>
          </Button>
        }
      />
      <div className="rounded-xl border border-border bg-card p-4 shadow-soft">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded-full bg-info-soft px-3 py-1.5 text-info-foreground">
            Rastreabilidade
          </span>
          <span>
            Aplicação concluída → consumo de estoque → transação de entitlement → evento de
            compensação → auditoria.
          </span>
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-soft">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                {[
                  "Data",
                  "Paciente",
                  "Serviço",
                  "Profissional executor",
                  "Produto / lote",
                  "Qtd.",
                  "Origem",
                  "Status",
                ].map((h) => (
                  <th key={h} className="px-4 py-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {applications.map((a) => (
                <tr key={a.id} className="border-t border-border hover:bg-muted/20">
                  <td className="px-4 py-4 text-xs text-muted-foreground">
                    {a.date}
                    <p>{a.id}</p>
                  </td>
                  <td className="px-4 py-4 font-medium">{a.patient}</td>
                  <td className="px-4 py-4">{a.service}</td>
                  <td className="px-4 py-4">{a.professional}</td>
                  <td className="px-4 py-4">
                    <span className="font-medium">{a.product}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{a.lot}</span>
                  </td>
                  <td className="px-4 py-4 font-semibold">{a.quantity}</td>
                  <td className="px-4 py-4">
                    <Badge variant="outline">{a.origin}</Badge>
                  </td>
                  <td className="px-4 py-4">
                    <Badge className="bg-success-soft text-success-foreground hover:bg-success-soft">
                      Concluída
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function NewApplicationPage() {
  return (
    <div className="space-y-7">
      <SectionHeader
        eyebrow="Operação · Aplicação"
        title="Nova aplicação"
        description="Fluxo visual de registro. A confirmação real será transacional no backend."
        action={
          <Button asChild variant="outline">
            <Link to="/aplicacoes">Cancelar</Link>
          </Button>
        }
      />
      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          <FormCard
            title="1. Atendimento"
            description="Identifique o paciente e o serviço executado."
          >
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Paciente" value="Paciente A." />
              <Field label="Serviço / procedimento" value="Protocolo Metabólico" />
            </div>
          </FormCard>
          <FormCard
            title="2. Execução"
            description="Profissional executor é diferente de vendedor, prescritor ou indicador quando aplicável."
          >
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Profissional executor" value="Enf. Ana Costa" />
              <Field label="Data / hora" value="03/10/2026 18:10" />
            </div>
          </FormCard>
          <FormCard
            title="3. Origem do consumo"
            description="O consumo deve estar autorizado por uma fonte válida."
          >
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Origem" value="Pacote" />
              <Field label="Entitlement" value="ENT-00071 · Protocolo Metabólico 30D" />
            </div>
          </FormCard>
          <FormCard
            title="4. Produto e lote"
            description="Seleção FEFO prioriza o lote disponível com vencimento mais próximo."
          >
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Produto" value="Injetável A" />
              <Field label="Lote" value="A24F08 · vence 18/02/2027" />
              <Field label="Quantidade" value="2 un" />
            </div>
            <div className="mt-4 rounded-lg bg-warning-soft p-3 text-xs text-warning-foreground">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>
                  Saldo será validado novamente no backend antes da confirmação. Estoque negativo
                  não é permitido.
                </span>
              </div>
            </div>
          </FormCard>
        </div>
        <aside className="h-fit rounded-xl border border-border bg-card p-5 shadow-soft">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Confirmação
          </p>
          <div className="mt-5 space-y-4 text-sm">
            <Summary label="Paciente" value="Paciente A." />
            <Summary label="Serviço" value="Protocolo Metabólico" />
            <Summary label="Produto" value="Injetável A · A24F08" />
            <Summary label="Quantidade" value="2 un" />
            <Summary label="Origem" value="Pacote" />
          </div>
          <div className="my-5 border-t border-border" />
          <p className="text-xs text-muted-foreground">
            Ao concluir, o backend deverá registrar a aplicação, consumo de entitlement, movimento
            de estoque, evento de compensação e auditoria em uma transação consistente.
          </p>
          <p className="mt-4 text-xs text-muted-foreground">
            Demonstração. Aplicação será habilitada no Milestone 4.
          </p>
          <Button className="mt-5 w-full" disabled>
            Confirmar aplicação
          </Button>
        </aside>
      </div>
    </div>
  );
}

function FormCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-soft">
      <h2 className="font-semibold">{title}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      <div className="mt-5">{children}</div>
    </div>
  );
}
function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <Input className="mt-1.5 bg-muted/20" value={value} readOnly />
    </div>
  );
}
function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}
