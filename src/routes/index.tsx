import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Activity,
  ArrowUpRight,
  Bell,
  CalendarDays,
  ChevronDown,
  CircleDollarSign,
  ClipboardList,
  Clock3,
  Command,
  FileText,
  FlaskConical,
  LayoutDashboard,
  MoreHorizontal,
  Package,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Users,
  WalletCards,
  X,
} from "lucide-react";

export const Route = createFileRoute("/")({
  component: Index,
});

type NavKey = "Visão geral" | "Agenda" | "Pacientes" | "Prontuário" | "Vendas" | "Estoque" | "Financeiro";

const navItems: Array<{ label: NavKey; icon: typeof LayoutDashboard }> = [
  { label: "Visão geral", icon: LayoutDashboard },
  { label: "Agenda", icon: CalendarDays },
  { label: "Pacientes", icon: Users },
  { label: "Prontuário", icon: FileText },
  { label: "Vendas", icon: WalletCards },
  { label: "Estoque", icon: Package },
  { label: "Financeiro", icon: CircleDollarSign },
];

const appointments = [
  { time: "08:00", patient: "Ana Carolina Lima", type: "Consulta", professional: "Dr. Marcos Scorsafava", status: "Confirmada", tone: "green" },
  { time: "09:00", patient: "Roberto Almeida", type: "Retorno", professional: "Dra. Thaíssa Scorsafava", status: "Aguardando", tone: "amber" },
  { time: "10:30", patient: "Juliana Martins", type: "Aplicação", professional: "Enfermagem", status: "Confirmada", tone: "green" },
  { time: "11:30", patient: "Carlos Eduardo", type: "Consulta", professional: "Dr. Marcos Scorsafava", status: "Novo", tone: "blue" },
];

const patients = [
  { initials: "AL", name: "Ana Carolina Lima", detail: "Plano Metabólico 30D", last: "Hoje, 08:00", score: "Em acompanhamento" },
  { initials: "RM", name: "Roberto Almeida", detail: "Retorno clínico", last: "Hoje, 09:00", score: "Aguardando" },
  { initials: "JM", name: "Juliana Martins", detail: "Aplicação · Neurozen", last: "Hoje, 10:30", score: "Ativa" },
  { initials: "CE", name: "Carlos Eduardo", detail: "Primeira consulta", last: "Hoje, 11:30", score: "Novo" },
];

function Index() {
  const [active, setActive] = useState<NavKey>("Visão geral");
  const [searchOpen, setSearchOpen] = useState(false);

  const pageTitle = useMemo(() => active, [active]);

  return (
    <div className="min-h-screen bg-[#f6f7f9] text-[#172033]">
      <div className="flex min-h-screen">
        <aside className="hidden w-[248px] shrink-0 border-r border-slate-200/80 bg-white lg:flex lg:flex-col">
          <div className="flex h-[76px] items-center border-b border-slate-100 px-6">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#172033] text-white shadow-sm">
                <Activity size={19} strokeWidth={2.2} />
              </div>
              <div>
                <div className="text-[15px] font-semibold tracking-[-0.02em]">Clinic OS</div>
                <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-400">Health operating system</div>
              </div>
            </div>
          </div>

          <div className="px-3 py-5">
            <div className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Clínica</div>
            <nav className="space-y-1">
              {navItems.map(({ label, icon: Icon }) => {
                const selected = active === label;
                return (
                  <button
                    key={label}
                    onClick={() => setActive(label)}
                    className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] font-medium transition-all ${
                      selected
                        ? "bg-[#172033] text-white shadow-sm"
                        : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                    }`}
                  >
                    <Icon size={17} strokeWidth={selected ? 2.2 : 1.8} />
                    <span>{label}</span>
                    {label === "Agenda" && <span className="ml-auto rounded-full bg-white/10 px-2 py-0.5 text-[10px]">4</span>}
                  </button>
                );
              })}
            </nav>

            <div className="mb-2 mt-8 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Gestão</div>
            <nav className="space-y-1">
              <button className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium text-slate-600 transition hover:bg-slate-50">
                <ClipboardList size={17} strokeWidth={1.8} />
                <span>CRM</span>
              </button>
              <button className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium text-slate-600 transition hover:bg-slate-50">
                <FlaskConical size={17} strokeWidth={1.8} />
                <span>Exames</span>
              </button>
              <button className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium text-slate-600 transition hover:bg-slate-50">
                <Settings2 size={17} strokeWidth={1.8} />
                <span>Configurações</span>
              </button>
            </nav>
          </div>

          <div className="mt-auto p-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-500">
                <ShieldCheck size={14} />
                Ambiente seguro
              </div>
              <div className="mt-2 text-[11px] leading-5 text-slate-400">Dados clínicos protegidos por controle de acesso e auditoria.</div>
            </div>
            <div className="mt-4 flex items-center gap-3 px-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600">MS</div>
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold">Marcos Scorsafava</div>
                <div className="text-[10px] text-slate-400">Administrador</div>
              </div>
              <ChevronDown size={15} className="ml-auto text-slate-400" />
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <header className="sticky top-0 z-20 flex h-[76px] items-center justify-between border-b border-slate-200/80 bg-white/90 px-5 backdrop-blur-xl lg:px-8">
            <div>
              <div className="text-[11px] font-medium text-slate-400">Sexta-feira, 3 de outubro</div>
              <h1 className="mt-0.5 text-[20px] font-semibold tracking-[-0.025em]">{pageTitle}</h1>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSearchOpen(true)}
                className="hidden h-10 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs text-slate-400 transition hover:border-slate-300 hover:bg-white sm:flex"
              >
                <Search size={15} />
                Buscar paciente
                <span className="ml-3 flex items-center gap-0.5 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[9px] font-semibold text-slate-400">
                  <Command size={9} /> K
                </span>
              </button>
              <button className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50">
                <Bell size={17} />
                <span className="absolute right-2.5 top-2 h-1.5 w-1.5 rounded-full bg-rose-500 ring-2 ring-white" />
              </button>
              <button className="flex h-10 items-center gap-2 rounded-xl bg-[#172033] px-3.5 text-xs font-semibold text-white shadow-sm transition hover:bg-[#232e43]">
                <Plus size={15} />
                Novo
              </button>
            </div>
          </header>

          <div className="mx-auto max-w-[1480px] p-5 lg:p-8">
            {active === "Visão geral" ? (
              <>
                <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <MetricCard label="Pacientes ativos" value="1.248" delta="+8,4%" icon={Users} />
                  <MetricCard label="Agenda hoje" value="18" delta="4 aguardando" icon={CalendarDays} />
                  <MetricCard label="Receita do mês" value="R$ 86.420" delta="+12,7%" icon={CircleDollarSign} />
                  <MetricCard label="Aplicações hoje" value="12" delta="98% concluídas" icon={Activity} />
                </section>

                <section className="mt-5 grid gap-5 xl:grid-cols-[1.55fr_1fr]">
                  <div className="rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.02)]">
                    <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                      <div>
                        <div className="text-sm font-semibold">Agenda de hoje</div>
                        <div className="mt-0.5 text-[11px] text-slate-400">18 compromissos · Unidade Aldeota</div>
                      </div>
                      <button onClick={() => setActive("Agenda")} className="flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-slate-900">
                        Ver agenda <ArrowUpRight size={13} />
                      </button>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {appointments.map((item) => (
                        <div key={item.time} className="flex items-center gap-4 px-5 py-4">
                          <div className="w-12 text-xs font-semibold text-slate-500">{item.time}</div>
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-500">
                            {item.patient.split(" ").map((n) => n[0]).slice(0, 2).join("")}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-xs font-semibold">{item.patient}</div>
                            <div className="mt-0.5 truncate text-[10px] text-slate-400">{item.type} · {item.professional}</div>
                          </div>
                          <StatusBadge tone={item.tone} label={item.status} />
                          <button className="hidden text-slate-300 hover:text-slate-600 sm:block"><MoreHorizontal size={16} /></button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.02)]">
                    <div className="border-b border-slate-100 px-5 py-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm font-semibold">Visão financeira</div>
                          <div className="mt-0.5 text-[11px] text-slate-400">Outubro · competência</div>
                        </div>
                        <CircleDollarSign size={18} className="text-slate-300" />
                      </div>
                    </div>
                    <div className="space-y-5 p-5">
                      <div>
                        <div className="flex items-end justify-between">
                          <span className="text-[11px] text-slate-400">Receita realizada</span>
                          <span className="text-lg font-semibold tracking-tight">R$ 86.420</span>
                        </div>
                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full w-[72%] rounded-full bg-[#172033]" />
                        </div>
                        <div className="mt-1.5 flex justify-between text-[10px] text-slate-400"><span>72% da meta</span><span>R$ 120 mil</span></div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <MiniMetric label="A receber" value="R$ 24.680" />
                        <MiniMetric label="Custos" value="R$ 31.240" />
                        <MiniMetric label="Margem" value="63,9%" />
                        <MiniMetric label="Ticket médio" value="R$ 1.840" />
                      </div>
                      <div className="flex items-center gap-2 rounded-xl bg-slate-50 p-3 text-[10px] leading-4 text-slate-500">
                        <Sparkles size={14} className="shrink-0 text-slate-400" />
                        Margem calculada a partir dos custos conhecidos e lançamentos conciliados.
                      </div>
                    </div>
                  </div>
                </section>

                <section className="mt-5 grid gap-5 xl:grid-cols-[1fr_0.72fr]">
                  <div className="rounded-2xl border border-slate-200 bg-white">
                    <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                      <div>
                        <div className="text-sm font-semibold">Pacientes recentes</div>
                        <div className="mt-0.5 text-[11px] text-slate-400">Últimas movimentações</div>
                      </div>
                      <button onClick={() => setActive("Pacientes")} className="text-[11px] font-semibold text-slate-500 hover:text-slate-900">Ver todos</button>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {patients.map((patient) => (
                        <button key={patient.name} className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition hover:bg-slate-50">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#eef1f5] text-[10px] font-semibold text-slate-600">{patient.initials}</div>
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-semibold">{patient.name}</div>
                            <div className="mt-0.5 text-[10px] text-slate-400">{patient.detail}</div>
                          </div>
                          <div className="hidden text-right sm:block">
                            <div className="text-[10px] font-medium text-slate-500">{patient.score}</div>
                            <div className="mt-0.5 text-[9px] text-slate-400">{patient.last}</div>
                          </div>
                          <ArrowUpRight size={14} className="text-slate-300" />
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-[#172033] p-5 text-white">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Patient 360</div>
                        <div className="mt-2 text-xl font-semibold tracking-[-0.025em]">Uma única história.</div>
                        <div className="mt-2 max-w-sm text-[11px] leading-5 text-slate-400">CRM, agenda, prontuário, tratamentos, estoque e financeiro conectados ao mesmo paciente.</div>
                      </div>
                      <Stethoscope size={22} className="text-slate-500" />
                    </div>
                    <div className="mt-7 grid grid-cols-3 gap-2">
                      <div className="rounded-xl bg-white/5 p-3"><div className="text-lg font-semibold">1.248</div><div className="mt-1 text-[9px] text-slate-500">pacientes</div></div>
                      <div className="rounded-xl bg-white/5 p-3"><div className="text-lg font-semibold">98,2%</div><div className="mt-1 text-[9px] text-slate-500">dados auditados</div></div>
                      <div className="rounded-xl bg-white/5 p-3"><div className="text-lg font-semibold">4</div><div className="mt-1 text-[9px] text-slate-500">unidades</div></div>
                    </div>
                  </div>
                </section>

                <section className="mt-5 rounded-2xl border border-slate-200 bg-white">
                  <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                    <div>
                      <div className="text-sm font-semibold">Atalhos operacionais</div>
                      <div className="mt-0.5 text-[11px] text-slate-400">Ações frequentes da equipe</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 divide-x divide-y divide-slate-100 sm:grid-cols-4 sm:divide-y-0">
                    <QuickAction icon={Users} label="Novo paciente" />
                    <QuickAction icon={CalendarDays} label="Novo agendamento" />
                    <QuickAction icon={WalletCards} label="Nova venda" />
                    <QuickAction icon={Package} label="Registrar aplicação" />
                  </div>
                </section>
              </>
            ) : (
              <PlaceholderPage title={active} onBack={() => setActive("Visão geral")} />
            )}
          </div>
        </main>
      </div>

      {searchOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/30 p-4 pt-[12vh] backdrop-blur-sm" onClick={() => setSearchOpen(false)}>
          <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 border-b border-slate-100 p-4">
              <Search size={18} className="text-slate-400" />
              <input autoFocus placeholder="Buscar paciente, CPF ou telefone..." className="flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400" />
              <button onClick={() => setSearchOpen(false)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X size={16} /></button>
            </div>
            <div className="p-3">
              <div className="px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-400">Sugestões</div>
              {patients.slice(0, 3).map((patient) => (
                <button key={patient.name} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-slate-50">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-[9px] font-semibold text-slate-600">{patient.initials}</div>
                  <div><div className="text-xs font-semibold">{patient.name}</div><div className="text-[10px] text-slate-400">{patient.detail}</div></div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, value, delta, icon: Icon }: { label: string; value: string; delta: string; icon: typeof Users }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.02)]">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-medium text-slate-400">{label}</div>
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-50 text-slate-400"><Icon size={15} /></div>
      </div>
      <div className="mt-4 text-[25px] font-semibold tracking-[-0.035em]">{value}</div>
      <div className="mt-1 flex items-center gap-1 text-[10px] font-medium text-emerald-600"><ArrowUpRight size={11} /> {delta}</div>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3"><div className="text-[9px] text-slate-400">{label}</div><div className="mt-1 text-xs font-semibold">{value}</div></div>;
}

function StatusBadge({ tone, label }: { tone: string; label: string }) {
  const styles: Record<string, string> = {
    green: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
    blue: "bg-sky-50 text-sky-700",
  };
  return <span className={`rounded-full px-2.5 py-1 text-[9px] font-semibold ${styles[tone] ?? styles.blue}`}>{label}</span>;
}

function QuickAction({ icon: Icon, label }: { icon: typeof Users; label: string }) {
  return <button className="flex items-center gap-3 px-5 py-4 text-left transition hover:bg-slate-50"><div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-50 text-slate-500"><Icon size={15} /></div><span className="text-[11px] font-semibold text-slate-600">{label}</span></button>;
}

function PlaceholderPage({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="flex min-h-[65vh] items-center justify-center">
      <div className="max-w-md text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-slate-400 shadow-sm ring-1 ring-slate-200"><Clock3 size={20} /></div>
        <h2 className="mt-5 text-lg font-semibold">{title}</h2>
        <p className="mt-2 text-xs leading-5 text-slate-400">Esta área está representada no protótipo visual. O backend e os fluxos de domínio ainda não foram conectados.</p>
        <button onClick={onBack} className="mt-5 rounded-xl bg-[#172033] px-4 py-2 text-xs font-semibold text-white">Voltar à visão geral</button>
      </div>
    </div>
  );
}
