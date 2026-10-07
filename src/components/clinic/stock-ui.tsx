import type { ReactNode } from "react";
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
import {
  applications,
  formatBRL,
  stockLocations,
  stockLots,
  stockMovements,
  stockProducts,
} from "@/data/mock-stock";

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
  action?: ReactNode;
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
}: {
  searchPlaceholder?: string;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-soft lg:flex-row lg:items-center">
      <div className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder={searchPlaceholder} className="h-10 pl-9" />
      </div>
      <Select defaultValue="all">
        <SelectTrigger className="w-full lg:w-44">
          <SelectValue placeholder="Localização" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todas as localizações</SelectItem>
          {stockLocations.map((location) => (
            <SelectItem key={location} value={location}>
              {location}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select defaultValue="all">
        <SelectTrigger className="w-full lg:w-40">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos os status</SelectItem>
          <SelectItem value="low">Estoque baixo</SelectItem>
          <SelectItem value="critical">Crítico</SelectItem>
          <SelectItem value="expiry">Próximo do vencimento</SelectItem>
        </SelectContent>
      </Select>
      <Button variant="outline">
        <SlidersHorizontal />
        Mais filtros
      </Button>
    </div>
  );
}

export function StockOverviewPage() {
  const totalValue = stockProducts.reduce((sum, p) => sum + p.quantity * p.cost, 0);
  const belowMinimum = stockProducts.filter((p) => p.quantity < p.minimum).length;
  return (
    <div className="space-y-7">
      <SectionHeader
        eyebrow="Operação · Inventário"
        title="Estoque"
        description="Visão operacional do estoque por produto, lote, localização e validade."
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
          label="Valor em estoque"
          value={formatBRL(totalValue)}
          detail="Saldo derivado das movimentações"
        />
        <MetricCard
          icon={AlertTriangle}
          label="Abaixo do mínimo"
          value={`${belowMinimum} ${belowMinimum === 1 ? "item" : "itens"}`}
          detail="Requerem reposição"
          tone="warning"
        />
        <MetricCard
          icon={CalendarClock}
          label="Próximos do vencimento"
          value="2 lotes"
          detail="Vencem nos próximos 30 dias"
          tone="warning"
        />
        <MetricCard
          icon={XCircle}
          label="Bloqueios / alertas"
          value="1 lote"
          detail="Revisar antes de movimentar"
          tone="danger"
        />
      </div>
      <StockFilters />
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
                    {formatBRL(product.quantity * product.cost)}
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
  const product = stockProducts.find((item) => item.id === productId);
  if (!product) {
    return (
      <div className="space-y-7">
        <SectionHeader
          eyebrow="Estoque · Produto"
          title="Produto não encontrado"
          description="Este produto fictício não está disponível na prévia."
          action={
            <Button asChild variant="outline">
              <Link to="/estoque">
                <Package />
                Voltar ao estoque
              </Link>
            </Button>
          }
        />
      </div>
    );
  }
  const lots = stockLots.filter((lot) => lot.productId === product.id);
  const movements = stockMovements.filter((m) => m.productId === product.id);
  const suppliers = [...new Set(lots.map((lot) => lot.supplier))];
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
                  {["Lote", "Validade", "Fornecedor", "Custo", "Quantidade", "Status"].map((h) => (
                    <th key={h} className="px-5 py-3 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lots.map((lot) => (
                  <tr key={lot.id} className="border-t border-border">
                    <td className="px-5 py-4 font-medium">{lot.lot}</td>
                    <td className="px-5 py-4">{lot.expiry}</td>
                    <td className="px-5 py-4 text-muted-foreground">{lot.supplier}</td>
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
          {lots.length === 0 && (
            <p className="px-5 py-6 text-sm text-muted-foreground">
              Nenhum lote registrado para este produto.
            </p>
          )}
        </div>
        <div className="rounded-xl border border-border bg-card p-5 shadow-soft">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Fornecedores
          </p>
          <div className="mt-4 space-y-3">
            {suppliers.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Nenhum fornecedor com lote registrado.
              </p>
            )}
            {suppliers.map((s) => (
              <div
                key={s}
                className="flex items-center justify-between rounded-lg border border-border p-3"
              >
                <span className="font-medium">{s}</span>
                <span className="text-xs text-muted-foreground">Lead time · 45 dias</span>
              </div>
            ))}
          </div>
          <div className="mt-5 rounded-lg bg-warning-soft p-3 text-sm text-warning-foreground">
            <div className="flex gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>Planejar reposição com antecedência devido ao lead time.</span>
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
            <p className="px-5 py-6 text-sm text-muted-foreground">
              Nenhuma movimentação registrada para este produto.
            </p>
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

export function ReceivingPage() {
  return (
    <div className="space-y-7">
      <SectionHeader
        eyebrow="Estoque · Entrada"
        title="Receber compra"
        description="Registre a entrada física por produto, lote, validade e custo. Recebimentos podem ser parciais."
        action={
          <Button variant="outline">
            <XCircle />
            Cancelar
          </Button>
        }
      />
      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          <div className="rounded-xl border border-border bg-card p-5 shadow-soft">
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Fornecedor</label>
                <Select defaultValue="essentia">
                  <SelectTrigger className="mt-1.5">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="essentia">Essentia</SelectItem>
                    <SelectItem value="stin">Stin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  Pedido de compra
                </label>
                <Input className="mt-1.5" value="PO-00042" readOnly />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Localização</label>
                <Select defaultValue="clinica">
                  <SelectTrigger className="mt-1.5">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="clinica">Clínica Fortaleza</SelectItem>
                    <SelectItem value="sala">Sala de Procedimentos</SelectItem>
                    <SelectItem value="almox">Almoxarifado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-border bg-card shadow-soft">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h2 className="font-semibold">Itens recebidos</h2>
                <p className="text-xs text-muted-foreground">
                  Dados de lote são obrigatórios para itens rastreáveis.
                </p>
              </div>
              <Button variant="outline" size="sm">
                <Plus />
                Adicionar item
              </Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                  <tr>
                    {["Produto", "Lote", "Validade", "Qtd.", "Custo unit.", "Subtotal"].map((h) => (
                      <th key={h} className="px-5 py-3 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { p: "Injetável A", lot: "A24F08", exp: "18/02/2027", q: 40, c: 185 },
                    { p: "Material C", lot: "MC-2601", exp: "30/01/2029", q: 100, c: 4.8 },
                  ].map((item) => (
                    <tr key={item.lot} className="border-t border-border">
                      <td className="px-5 py-4 font-medium">{item.p}</td>
                      <td className="px-5 py-4">{item.lot}</td>
                      <td className="px-5 py-4">{item.exp}</td>
                      <td className="px-5 py-4">{item.q}</td>
                      <td className="px-5 py-4">{formatBRL(item.c)}</td>
                      <td className="px-5 py-4 font-medium">{formatBRL(item.q * item.c)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <aside className="h-fit rounded-xl border border-border bg-card p-5 shadow-soft">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Resumo
          </p>
          <div className="mt-5 space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Itens</span>
              <span>2</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Unidades</span>
              <span>140</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Custo total</span>
              <span className="font-semibold">{formatBRL(7880)}</span>
            </div>
          </div>
          <div className="my-5 border-t border-border" />
          <div className="rounded-lg bg-info-soft p-3 text-xs text-info-foreground">
            Ao confirmar, o recebimento gera movimentos de entrada e atualiza o saldo derivado. O
            pedido pode permanecer parcialmente recebido.
          </div>
          <Button className="mt-5 w-full">Confirmar recebimento</Button>
        </aside>
      </div>
    </div>
  );
}

export function MovementsPage() {
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
      <StockFilters searchPlaceholder="Buscar produto, lote, referência ou responsável" />
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
        description="Registro operacional que conecta paciente, execução, origem do consumo e lote utilizado."
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
          <Button className="mt-5 w-full">Confirmar aplicação</Button>
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
  children: ReactNode;
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
