import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  HeartPulse,
  Landmark,
  ListChecks,
  Menu,
  Package,
  PackageCheck,
  ShieldCheck,
  Users,
  Warehouse,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
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
  { label: "Estoque", to: "/estoque", icon: Package },
  { label: "Compras e recebimentos", to: "/estoque/recebimento", icon: PackageCheck },
  { label: "Movimentações", to: "/estoque/movimentacoes", icon: ListChecks },
] as const;
const registryItems = [
  { label: "Produtos e locais", to: "/estoque/cadastros", icon: Warehouse },
  { label: "Fornecedores e pedidos", to: "/estoque/fornecedores", icon: Landmark },
  { label: "Valores de venda", to: "/estoque/valores", icon: ListChecks },
] as const;

const pageTitles: Record<string, string> = {
  "/estoque": "Estoque",
  "/estoque/recebimento": "Compras e recebimentos",
  "/estoque/movimentacoes": "Movimentações",
  "/estoque/cadastros": "Produtos e locais",
  "/estoque/fornecedores": "Fornecedores e pedidos",
  "/estoque/valores": "Valores de venda",
  "/estoque/usuarios": "Usuários do estoque",
  "/estoque/minha-conta": "Minha conta",
};

type Identity = {
  user: { name: string };
  role: string;
  units: Array<{ id: string; name: string }>;
};

const roleLabels: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  PARTNER_ADMIN: "Sócio administrador",
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
      to="/"
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
  identity,
  onNavigate,
}: {
  identity: Identity | null;
  onNavigate?: (() => void) | undefined;
}) {
  const path = useRouterState({ select: (state) => state.location.pathname });
  const renderItems = (items: typeof operationItems | typeof registryItems) =>
    items.map((item) => {
      const active = item.to === "/estoque" ? path === "/estoque" : path.startsWith(item.to);
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
        Operação
      </p>
      <div className="space-y-1">{renderItems(operationItems)}</div>
      <p className="mb-2 mt-7 px-3 text-[10px] font-semibold uppercase tracking-widest text-sidebar-muted">
        Cadastros
      </p>
      <div className="space-y-1">{renderItems(registryItems)}</div>
      <p className="mb-2 mt-7 px-3 text-[10px] font-semibold uppercase tracking-widest text-sidebar-muted">
        Administração
      </p>
      <div className="space-y-1">
        {identity?.role === "SUPER_ADMIN" && (
          <Link
            to="/estoque/usuarios"
            onClick={onNavigate}
            className="group flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium text-sidebar-muted transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
          >
            <Users className="size-4" />
            Usuários
          </Link>
        )}
        <Link
          to="/estoque/minha-conta"
          onClick={onNavigate}
          className="group flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium text-sidebar-muted transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
        >
          <ShieldCheck className="size-4" />
          Minha conta
        </Link>
      </div>
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
    <div className="flex h-full flex-col bg-sidebar">
      <div className="border-b border-sidebar-border px-5 py-5">
        <ProductMark />
      </div>
      <Navigation identity={identity} onNavigate={onNavigate} />
      <div className="border-t border-sidebar-border p-4">
        <div className="mb-4 flex items-center gap-2 rounded-md bg-sidebar-accent/50 px-3 py-2 text-[11px] text-sidebar-muted">
          <ShieldCheck className="size-4 text-sidebar-primary" />
          <span>Piloto operacional controlado</span>
        </div>
        <div className="flex items-center gap-3">
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
        </div>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const path = useRouterState({ select: (state) => state.location.pathname });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [unitId, setUnitId] = useState("");
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!path.startsWith("/estoque")) return;
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
  const title = pageTitles[path] ?? "Allik One";
  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] border-r border-sidebar-border lg:block">
        <SidebarContent identity={identity} />
      </aside>
      <div className="min-w-0 lg:pl-[248px]">
        <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
          <div className="grid min-h-16 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 lg:px-7">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="min-h-11 min-w-11 lg:hidden"
                  aria-label="Abrir menu"
                >
                  <Menu />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[286px] border-sidebar-border bg-sidebar p-0">
                <SheetTitle className="sr-only">Navegação principal</SheetTitle>
                <SheetDescription className="sr-only">
                  Áreas operacionais do Allik One
                </SheetDescription>
                <SidebarContent identity={identity} onNavigate={() => setMobileOpen(false)} />
              </SheetContent>
            </Sheet>
            <div className="hidden min-w-0 lg:block">
              <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                Allik One · Operação de estoque
              </p>
              <p className="truncate font-display text-base font-semibold text-foreground">
                {title}
              </p>
            </div>
            <div className="min-w-0" />
            <div className="min-w-0 text-right">
              {identity ? (
                <>
                  <p className="max-w-44 truncate text-sm font-medium text-foreground sm:max-w-none">
                    {identity.user.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {roleLabels[identity.role] ?? identity.role} · Piloto operacional
                  </p>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">Piloto operacional</p>
              )}
            </div>
          </div>
        </header>
        {path.startsWith("/estoque") && identity && (
          <div className="flex flex-wrap items-center justify-end gap-3 border-b bg-muted/30 px-4 py-2 text-sm lg:px-7">
            <div className="flex items-center gap-2">
              <label htmlFor="inventory-unit" className="text-muted-foreground">
                Unidade
              </label>
              <select
                id="inventory-unit"
                className="h-9 rounded-md border bg-background px-3"
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
              <Button
                variant="outline"
                size="sm"
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
            </div>
          </div>
        )}
        <main className="mx-auto w-full max-w-[1600px] p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
