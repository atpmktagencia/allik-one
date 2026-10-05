import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Archive,
  Bell,
  CalendarDays,
  ChevronDown,
  ClipboardPlus,
  FileHeart,
  FlaskConical,
  HeartPulse,
  LayoutDashboard,
  Menu,
  Package,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Stethoscope,
  Users,
  WalletCards,
} from "lucide-react";
import { patients } from "@/data/mock-clinic";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { selectedUnitId, setSelectedUnitId } from "@/data/unit-context";

const mainItems = [
  { label: "Visão geral", to: "/", icon: LayoutDashboard },
  { label: "Agenda", to: "/agenda", icon: CalendarDays },
  { label: "Pacientes", to: "/pacientes", icon: Users },
  { label: "Prontuário", to: "/prontuario", icon: FileHeart },
  { label: "Vendas", to: "/vendas", icon: WalletCards },
  { label: "Estoque", to: "/estoque", icon: Package },
  { label: "Aplicações", to: "/aplicacoes", icon: ClipboardPlus },
  { label: "Financeiro", to: "/financeiro", icon: Archive },
] as const;
const managementItems = [
  { label: "CRM", to: "/crm", icon: Activity },
  { label: "Exames", to: "/exames", icon: FlaskConical },
  { label: "Configurações", to: "/configuracoes", icon: Settings },
] as const;

const pageTitles: Record<string, string> = {
  "/": "Visão geral",
  "/agenda": "Agenda",
  "/pacientes": "Pacientes",
  "/prontuario": "Prontuário",
  "/vendas": "Vendas",
  "/estoque": "Estoque",
  "/financeiro": "Financeiro",
  "/aplicacoes": "Aplicações",
  "/crm": "CRM",
  "/exames": "Exames",
  "/configuracoes": "Configurações",
};

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
          Allik Fortaleza
        </span>
        <span className="block text-[11px] text-sidebar-muted">Estoque e aplicações</span>
      </span>
    </Link>
  );
}

function Navigation({ onNavigate }: { onNavigate?: (() => void) | undefined }) {
  const path = useRouterState({ select: (state) => state.location.pathname });
  const renderItems = (items: typeof mainItems | typeof managementItems) =>
    items.map((item) => {
      const active = item.to === "/" ? path === "/" : path.startsWith(item.to);
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
      <div className="space-y-1">{renderItems(mainItems)}</div>
      <p className="mb-2 mt-7 px-3 text-[10px] font-semibold uppercase tracking-widest text-sidebar-muted">
        Gestão
      </p>
      <div className="space-y-1">{renderItems(managementItems)}</div>
    </nav>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: (() => void) | undefined }) {
  return (
    <div className="flex h-full flex-col bg-sidebar">
      <div className="border-b border-sidebar-border px-5 py-5">
        <ProductMark />
      </div>
      <Navigation onNavigate={onNavigate} />
      <div className="border-t border-sidebar-border p-4">
        <div className="mb-4 flex items-center gap-2 rounded-md bg-sidebar-accent/50 px-3 py-2 text-[11px] text-sidebar-muted">
          <ShieldCheck className="size-4 text-sidebar-primary" />
          <span>Demonstração sintética</span>
        </div>
        <div className="flex items-center gap-3">
          <Avatar className="size-9">
            <AvatarFallback className="bg-sidebar-accent text-xs font-semibold text-sidebar-foreground">
              MS
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-sidebar-foreground">
              Operador de demonstração
            </p>
            <p className="text-[11px] text-sidebar-muted">Preview</p>
          </div>
          <ChevronDown className="size-3.5 text-sidebar-muted" />
        </div>
      </div>
    </div>
  );
}

function GlobalSearch() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const results = useMemo(() => {
    const normalized = query.toLocaleLowerCase("pt-BR").replace(/\D/g, "");
    if (query.trim().length < 2) return [];
    return patients.filter(
      (patient) =>
        patient.name.toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR")) ||
        patient.cpf.replace(/\D/g, "").includes(normalized) ||
        patient.phone.replace(/\D/g, "").includes(normalized),
    );
  }, [query]);
  const choose = (patientId: string) => {
    setQuery("");
    setOpen(false);
    navigate({ to: "/pacientes/$patientId", params: { patientId } });
  };
  return (
    <div className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        placeholder="Buscar paciente, CPF ou telefone"
        aria-label="Buscar paciente"
        className="h-10 bg-muted/60 pl-9 shadow-none"
      />
      {open && query.length >= 2 && (
        <div className="absolute left-0 right-0 top-12 z-50 overflow-hidden rounded-md border border-border bg-popover shadow-panel">
          <div className="border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            Pacientes fictícios
          </div>
          {results.length ? (
            results.map((patient) => (
              <button
                key={patient.id}
                type="button"
                onMouseDown={() => choose(patient.id)}
                className="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-accent focus:bg-accent focus:outline-none"
              >
                <Avatar className="size-8">
                  <AvatarFallback className="bg-info-soft text-xs font-semibold text-info-foreground">
                    {patient.initials}
                  </AvatarFallback>
                </Avatar>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-popover-foreground">
                    {patient.name}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {patient.cpf} · {patient.phone}
                  </span>
                </span>
              </button>
            ))
          ) : (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              Nenhum paciente encontrado
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const path = useRouterState({ select: (state) => state.location.pathname });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [identity, setIdentity] = useState<{
    user: { name: string };
    role: string;
    units: Array<{ id: string; name: string }>;
  } | null>(null);
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
  const title = path.startsWith("/pacientes/")
    ? "Patient 360"
    : (pageTitles[path] ?? "Allik Fortaleza");
  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] border-r border-sidebar-border lg:block">
        <SidebarContent />
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
                <SheetDescription className="sr-only">Áreas do Allik Fortaleza</SheetDescription>
                <SidebarContent onNavigate={() => setMobileOpen(false)} />
              </SheetContent>
            </Sheet>
            <div className="hidden min-w-0 lg:block">
              <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                Sábado, 3 de outubro
              </p>
              <p className="truncate font-display text-base font-semibold text-foreground">
                {title}
              </p>
            </div>
            <div className="min-w-0 lg:ml-auto lg:w-[420px]">
              <GlobalSearch />
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button
                variant="ghost"
                size="icon"
                className="relative min-h-11 min-w-11"
                aria-label="Notificações"
              >
                <Bell />
                <span className="absolute right-2 top-2 size-1.5 rounded-full bg-destructive" />
              </Button>
              <Button className="hidden sm:inline-flex">
                <Plus />
                Novo
              </Button>
            </div>
          </div>
        </header>
        {path.startsWith("/estoque") && identity && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/30 px-4 py-2 text-sm lg:px-7">
            <div>
              <span className="font-medium">{identity.user.name}</span>
              <span className="ml-2 text-muted-foreground">{identity.role}</span>
            </div>
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
