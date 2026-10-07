import { Link } from "@tanstack/react-router";
import {
  Activity,
  ArrowRight,
  CalendarPlus,
  CircleDollarSign,
  Clock3,
  PackagePlus,
  Plus,
  Sparkles,
  TrendingUp,
  UserPlus,
  Users,
} from "lucide-react";
import { financial, patients, todaySchedule } from "@/data/mock-clinic";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { MetricCard, PageHeader, Section } from "./page-kit";
import { StatusPill } from "./status-pill";

export function OverviewPage() {
  const shortcuts = [
    { label: "Novo paciente", icon: UserPlus, to: "/pacientes" },
    { label: "Novo agendamento", icon: CalendarPlus, to: "/agenda" },
    { label: "Nova venda", icon: CircleDollarSign, to: "/vendas" },
    { label: "Registrar aplicação", icon: PackagePlus, to: "/aplicacoes/nova" },
  ] as const;
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Centro de operação"
        title="Bom dia, Marcos"
        description="A clínica está organizada. Veja o que precisa de atenção hoje."
        action={<p className="text-xs text-muted-foreground">Dados fictícios de demonstração</p>}
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Pacientes ativos"
          value="1.248"
          detail="+24 nos últimos 30 dias"
          icon={Users}
        />
        <MetricCard
          label="Agenda hoje"
          value="12"
          detail="9 confirmados · 2 aguardando"
          icon={Clock3}
          tone="warning"
        />
        <MetricCard
          label="Receita do mês"
          value={financial.revenue}
          detail="77% da meta mensal"
          icon={TrendingUp}
          tone="success"
        />
        <MetricCard
          label="Aplicações hoje"
          value="7"
          detail="3 concluídas · 4 previstas"
          icon={Activity}
          tone="neutral"
        />
      </div>
      <div className="grid gap-5 xl:grid-cols-[1.45fr_.75fr]">
        <Section
          title="Agenda de hoje"
          description="Sábado, 3 de outubro"
          action={
            <Button asChild variant="ghost" size="sm">
              <Link to="/agenda">
                Ver agenda <ArrowRight />
              </Link>
            </Button>
          }
        >
          <div>
            {todaySchedule.slice(0, 4).map((item) => (
              <div
                key={`${item.time}-${item.patient}`}
                className="grid grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-3 border-b border-border py-3.5 last:border-0"
              >
                <p className="font-display text-sm font-semibold">{item.time}</p>
                <div className="min-w-0">
                  <Link
                    to="/pacientes/$patientId"
                    params={{ patientId: item.patientId }}
                    className="block truncate text-sm font-medium hover:text-primary"
                  >
                    {item.patient}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground">
                    {item.type} · {item.professional}
                  </p>
                </div>
                <StatusPill label={item.status} />
              </div>
            ))}
          </div>
        </Section>
        <Section title="Atalhos" description="Ações frequentes">
          <div className="grid grid-cols-2 gap-2">
            {shortcuts.map((item) => (
              <Button
                key={item.label}
                asChild
                variant="outline"
                className="h-auto min-h-20 whitespace-normal p-3"
              >
                <Link to={item.to} className="flex-col">
                  <item.icon className="size-5 text-primary" />
                  <span className="text-xs">{item.label}</span>
                </Link>
              </Button>
            ))}
          </div>
        </Section>
      </div>
      <div className="grid gap-5 xl:grid-cols-[.9fr_1.1fr]">
        <Section title="Visão financeira" description="Outubro de 2026">
          <div className="flex items-end justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Receita realizada</p>
              <p className="mt-1 font-display text-2xl font-semibold">{financial.revenue}</p>
            </div>
            <p className="text-sm font-semibold text-success-foreground">
              {financial.targetProgress}% da meta
            </p>
          </div>
          <Progress value={financial.targetProgress} className="mt-4" />
          <div className="mt-5 grid grid-cols-2 gap-x-5 gap-y-4 border-t border-border pt-5 sm:grid-cols-4">
            {[
              ["A receber", financial.receivable],
              ["Custos", financial.costs],
              ["Margem", financial.margin],
              ["Ticket médio", financial.ticket],
            ].map(([label, value]) => (
              <div key={label}>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="mt-1 text-sm font-semibold">{value}</p>
              </div>
            ))}
          </div>
        </Section>
        <Section
          title="Pacientes recentes"
          description="Últimos relacionamentos atualizados"
          action={
            <Button asChild variant="ghost" size="sm">
              <Link to="/pacientes">
                Todos <ArrowRight />
              </Link>
            </Button>
          }
        >
          <div className="grid gap-1 sm:grid-cols-2">
            {patients.map((patient) => (
              <Link
                key={patient.id}
                to="/pacientes/$patientId"
                params={{ patientId: patient.id }}
                className="group flex min-w-0 items-center gap-3 rounded-md p-3 hover:bg-muted"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-info-soft text-xs font-semibold text-info-foreground">
                  {patient.initials}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{patient.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {patient.journey}
                  </span>
                </span>
                <ArrowRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </Link>
            ))}
          </div>
        </Section>
      </div>
      <section className="relative overflow-hidden rounded-lg border border-brand-strong bg-brand-strong p-6 text-brand-on sm:p-8">
        <div className="relative z-10 max-w-2xl">
          <div className="mb-5 flex size-10 items-center justify-center rounded-md bg-brand-on/10">
            <Sparkles className="size-5" />
          </div>
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-on/60">
            Patient 360
          </p>
          <h2 className="mt-2 font-display text-3xl font-semibold">Uma única história.</h2>
          <p className="mt-3 max-w-xl text-sm leading-6 text-brand-on/70">
            CRM, agenda, prontuário, tratamentos, estoque e financeiro compartilham a mesma
            identidade do paciente. Cada contato amplia o contexto — nunca o fragmenta.
          </p>
          <Button asChild variant="secondary" className="mt-6">
            <Link to="/pacientes/$patientId" params={{ patientId: "ana-beatriz" }}>
              Conhecer Patient 360 <ArrowRight />
            </Link>
          </Button>
        </div>
        <Activity className="absolute -bottom-10 -right-8 size-48 text-brand-on/5" />
      </section>
    </div>
  );
}
