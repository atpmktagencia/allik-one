import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ChevronsUpDown,
  HeartPulse,
  Syringe,
  Landmark,
  ShoppingCart,
  KeyRound,
  ListChecks,
  Menu,
  Package,
  PackageCheck,
  CalendarRange,
  CalendarDays,
  FlaskConical,
  UserRound,
  ShieldCheck,
  Users,
  Warehouse,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { selectedUnitId, setSelectedUnitId } from "@/data/unit-context";

const operationItems = [
  { label: "Estoque atual", to: "/estoque", icon: Package },
  { label: "Pedidos e entradas", to: "/estoque/recebimento", icon: PackageCheck },
  { label: "Movimentações e histórico", to: "/estoque/movimentacoes", icon: ListChecks },
  { label: "Produtos e sede", to: "/estoque/cadastros", icon: Warehouse },
  { label: "Fazer compra", to: "/estoque/fornecedores", icon: Landmark },
  { label: "Necessidade de compra", to: "/estoque/necessidade-compras", icon: ShoppingCart },
  { label: "Precificação", to: "/estoque/valores", icon: ListChecks },
] as const;

const careItems = [
  { label: "Catálogo clínico", to: "/catalogo-clinico", icon: FlaskConical },
  { label: "Pré-consultas", to: "/pre-consultas", icon: ListChecks },
  { label: "Tarefas da equipe", to: "/tarefas", icon: ListChecks },
  { label: "Agendamentos", to: "/agenda", icon: CalendarDays },
  { label: "Pacientes", to: "/pacientes", icon: UserRound },
] as const;

const procedureItems = [
  { label: "Aplicações", to: "/aplicacoes", icon: Syringe },
  { label: "Agenda de aplicações", to: "/agenda-aplicacoes", icon: CalendarDays },
  { label: "Demanda futura", to: "/pacientes/demanda", icon: CalendarRange },
  { label: "Apresentações abertas", to: "/pacientes/fracionamento", icon: FlaskConical },
] as const;

const pageTitles: Record<string, string> = {
  "/catalogo-clinico": "Catálogo clínico",
  "/tarefas": "Tarefas da equipe",
  "/pre-consultas": "Pré-consultas",
  "/estoque": "Estoque atual",
  "/estoque/recebimento": "Pedidos e entradas",
  "/estoque/movimentacoes": "Movimentações e histórico",
  "/estoque/cadastros": "Produtos e sede",
  "/estoque/fornecedores": "Fazer compra",
  "/estoque/necessidade-compras": "Necessidade de compra",
  "/estoque/valores": "Precificação",
  "/aplicacoes": "Aplicações",
  "/aplicacoes/nova": "Registrar aplicação",
  "/pacientes": "Pacientes",
  "/pacientes/demanda": "Demanda futura",
  "/pacientes/fracionamento": "Apresentações abertas",
  "/agenda": "Agendamentos",
  "/agenda-aplicacoes": "Agenda de aplicações",
  "/estoque/usuarios": "Usuários",
  "/estoque/integracoes": "Integrações",
  "/estoque/minha-conta": "Minha conta",
  "/configuracoes": "Configurações da clínica",
};

type Identity = {
  user: { name: string };
  role: string;
  capabilities?: { canReadPricingCosts?: boolean; canManagePricing?: boolean };
  units: Array<{ id: string; name: string }>;
};

const roleLabels: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  PARTNER_ADMIN: "Sócio administrador",
  CLINICIAN: "Profissional de saúde",
  INVENTORY_MANAGER: "Supervisão de estoque",
  UNIT_MANAGER: "Gerência da unidade",
  FINANCE: "Financeiro",
  VIEWER: "Consulta",
};

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function ProductMark() {
  return (
    <Link
      to="/estoque"
      className="flex items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
    >
      <span className="flex size-9 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
        <HeartPulse className="size-5" />
      </span>
      <span>
        <span className="block font-display text-base font-semibold text-sidebar-foreground">
          Allik One
        </span>
        <span className="block text-[11px] text-sidebar-muted">Operações de estoque</span>
      </span>
    </Link>
  );
}

function Navigation({
  onNavigate,
  canReadPricingCosts = false,
}: {
  onNavigate?: (() => void) | undefined;
  canReadPricingCosts?: boolean;
}) {
  const path = useRouterState({ select: (state) => state.location.pathname });
  const renderItems = (
    items: ReadonlyArray<
      (typeof operationItems)[number] | (typeof careItems)[number] | (typeof procedureItems)[number]
    >,
  ) =>
    items.map((item) => {
      const active =
        item.to === "/estoque" || item.to === "/pacientes"
          ? path === item.to
          : path.startsWith(item.to);
      return (
        <Link
          key={item.to}
          to={item.to}
          onClick={onNavigate}
          className={cn(
            "group flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
            active
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-sidebar-muted hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
          )}
        >
          <item.icon className={cn("size-4", active && "text-sidebar-primary")} />
          <span>{item.label}</span>
          {active && <span className="ml-auto size-1.5 rounded-full bg-sidebar-primary" />}
        </Link>
      );
    });
  return (
    <nav className="flex flex-1 flex-col px-3 py-4">
      <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-widest text-sidebar-muted">
        Estoque
      </p>
      <div className="space-y-1">
        {renderItems(
          operationItems.filter((item) => item.to !== "/estoque/valores" || canReadPricingCosts),
        )}
      </div>
      <p className="mb-2 mt-7 px-3 text-[10px] font-semibold uppercase tracking-widest text-sidebar-muted">
        Atendimento
      </p>
      <div className="space-y-1">{renderItems(careItems)}</div>
      <p className="mb-2 mt-7 px-3 text-[10px] font-semibold uppercase tracking-widest text-sidebar-muted">
        Procedimentos
      </p>
      <div className="space-y-1">{renderItems(procedureItems)}</div>
    </nav>
  );
}

function SidebarContent({
  identity,
  onNavigate,
}: {
  identity: Identity | null;
  onNavigate?: (() => void) | undefined;
}) {
  const name = identity?.user.name ?? "Carregando conta…";
  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar">
      <div className="border-b border-sidebar-border px-5 py-5">
        <ProductMark />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <Navigation
          onNavigate={onNavigate}
          canReadPricingCosts={identity?.capabilities?.canReadPricingCosts === true}
        />
      </div>
      <div className="border-t border-sidebar-border p-4">
        <div className="mb-4 flex items-center gap-2 rounded-md bg-sidebar-accent/50 px-3 py-2 text-[11px] text-sidebar-muted">
          <ShieldCheck className="size-4 text-sidebar-primary" />
          <span>Piloto operacional controlado</span>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={!identity}
              aria-label={`Abrir menu da conta de ${name}`}
              className="flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring disabled:opacity-60"
            >
              <Avatar className="size-9">
                <AvatarFallback className="bg-sidebar-accent text-xs font-semibold text-sidebar-foreground">
                  {identity ? initials(identity.user.name) : "AO"}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-sidebar-foreground">{name}</p>
                <p className="text-[11px] text-sidebar-muted">
                  {identity ? (roleLabels[identity.role] ?? identity.role) : "Allik One"}
                </p>
              </div>
              <ChevronsUpDown className="size-4 shrink-0 text-sidebar-muted" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="top"
            align="start"
            sideOffset={8}
            className="w-64 max-w-[calc(100vw-2rem)] rounded-2xl p-2"
          >
            <DropdownMenuLabel>Administração</DropdownMenuLabel>
            <DropdownMenuItem asChild>
              <Link to="/configuracoes" onClick={onNavigate}>
                <Warehouse aria-hidden="true" /> Configurações
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/estoque/minha-conta" onClick={onNavigate}>
                <ShieldCheck aria-hidden="true" /> Minha conta
              </Link>
            </DropdownMenuItem>
            {(identity?.role === "SUPER_ADMIN" || identity?.role === "PARTNER_ADMIN") && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/estoque/usuarios" onClick={onNavigate}>
                    <Users aria-hidden="true" /> Usuários
                  </Link>
                </DropdownMenuItem>
                {identity?.role === "SUPER_ADMIN" && (
                  <DropdownMenuItem asChild>
                    <Link to="/estoque/integracoes" onClick={onNavigate}>
                      <KeyRound aria-hidden="true" /> Integrações
                    </Link>
                  </DropdownMenuItem>
                )}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const path = useRouterState({ select: (state) => state.location.pathname });
  const focusedEncounter = path.startsWith("/atendimentos/");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [unitId, setUnitId] = useState("");
  const queryClient = useQueryClient();
  useEffect(() => {
    if (
      !path.startsWith("/catalogo-clinico") &&
      !path.startsWith("/pre-consultas") &&
      !path.startsWith("/tarefas") &&
      !path.startsWith("/estoque") &&
      !path.startsWith("/pacientes") &&
      !path.startsWith("/agenda") &&
      !path.startsWith("/aplicacoes") &&
      !path.startsWith("/atendimentos/") &&
      !path.startsWith("/configuracoes")
    )
      return;
    void fetch("/api/inventory-session", { credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) return;
        const body = (await response.json()) as { data: typeof identity };
        if (!body.data) return;
        setIdentity(body.data);
        const saved = selectedUnitId();
        const initial = body.data.units.some((unit) => unit.id === saved)
          ? saved
          : body.data.units.length === 1
            ? body.data.units[0]!.id
            : "";
        setUnitId(initial);
        setSelectedUnitId(initial);
      })
      .catch(() => {});
  }, [path]);
  if (path === "/preconsulta") return <>{children}</>;
  const title = path.startsWith("/atendimentos/")
    ? "Atendimento"
    : path.startsWith("/pacientes/") && path.endsWith("/prontuario")
      ? "Prontuário"
      : (pageTitles[path] ?? "Allik One");
  return (
    <div className="min-h-screen bg-background">
      {!focusedEncounter ? (
        <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] border-r border-sidebar-border lg:block">
          <SidebarContent identity={identity} />
        </aside>
      ) : null}
      <div className={cn("min-w-0", !focusedEncounter && "lg:pl-[248px]")}>
        <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
          <div
            className={cn(
              "flex h-16 min-w-0 items-center gap-2 px-3 sm:gap-4 sm:px-4 lg:px-7",
              focusedEncounter && "mx-auto w-full max-w-[1320px]",
            )}
          >
            <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
              <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                <SheetTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn("min-h-11 min-w-11", !focusedEncounter && "lg:hidden")}
                    aria-label="Abrir menu"
                  >
                    <Menu />
                  </Button>
                </SheetTrigger>
                <SheetContent
                  side="left"
                  className="w-[286px] border-sidebar-border bg-sidebar p-0"
                >
                  <SheetTitle className="sr-only">Navegação principal</SheetTitle>
                  <SheetDescription className="sr-only">
                    Áreas operacionais do Allik One
                  </SheetDescription>
                  <SidebarContent identity={identity} onNavigate={() => setMobileOpen(false)} />
                </SheetContent>
              </Sheet>
              <div className={cn("min-w-0", !focusedEncounter && "hidden lg:block")}>
                <p className="hidden text-[11px] font-medium uppercase tracking-widest text-muted-foreground sm:block">
                  Allik One · Operação de estoque
                </p>
                <p className="truncate font-display text-sm font-semibold text-foreground sm:text-base">
                  {title}
                </p>
              </div>
            </div>
            <div className="flex min-w-0 shrink-0 justify-center">
              {identity ? (
                <label className="flex items-center gap-2 text-sm">
                  <span className="hidden text-muted-foreground md:inline">Unidade</span>
                  <select
                    id="inventory-unit"
                    aria-label="Unidade atual"
                    className="h-9 w-[132px] rounded-md border bg-background px-2 text-sm sm:w-auto sm:max-w-52 sm:px-3"
                    value={unitId}
                    onChange={(event) => {
                      const value = event.target.value;
                      setUnitId(value);
                      setSelectedUnitId(value);
                      void queryClient.invalidateQueries({ queryKey: ["inventory"] });
                    }}
                  >
                    {identity.units.length > 1 && <option value="">Todas as unidades</option>}
                    {identity.units.map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
            <div className="flex min-w-0 shrink-0 items-center justify-end gap-2 text-right sm:gap-3">
              {identity ? (
                <>
                  <p className="hidden max-w-44 truncate text-sm font-medium text-foreground lg:block xl:max-w-60">
                    {identity.user.name}
                  </p>
                  <p className="hidden text-xs text-muted-foreground 2xl:block">
                    {roleLabels[identity.role] ?? identity.role} · Piloto operacional
                  </p>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">Piloto operacional</p>
              )}
              {identity ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="hidden sm:inline-flex"
                  onClick={async () => {
                    await fetch("/api/inventory-session", {
                      method: "DELETE",
                      credentials: "same-origin",
                    });
                    setIdentity(null);
                    window.location.assign("/estoque/acesso");
                  }}
                >
                  Sair
                </Button>
              ) : null}
            </div>
          </div>
        </header>
        <main
          className={cn(
            "mx-auto w-full",
            focusedEncounter ? "max-w-none p-0" : "max-w-[1600px] p-4 sm:p-6 lg:p-8",
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
