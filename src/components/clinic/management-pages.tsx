import { Link } from "@tanstack/react-router";
import { ArrowRight, CheckCircle2, CircleDashed, FlaskConical, MessageSquareText, Settings2, SlidersHorizontal, Target, Users, type LucideIcon } from "lucide-react";
import { patients } from "@/data/mock-clinic";
import { Button } from "@/components/ui/button";
import { PageHeader, PreviewNotice, Section } from "./page-kit";
import { StatusPill } from "./status-pill";

export function CrmPage() {
  const stages = [{ title: "Novos contatos", count: 8, names: ["Fernanda Moraes", "Paulo Reis"] }, { title: "Em avaliação", count: 5, names: [patients[2].name, "Camila Torres"] }, { title: "Proposta enviada", count: 4, names: [patients[0].name, "Juliana Alves"] }, { title: "Convertidos", count: 12, names: [patients[1].name, patients[3].name] }];
  return <div className="space-y-6"><PageHeader eyebrow="Relacionamento" title="CRM" description="Da primeira conversa ao cuidado recorrente, sem duplicar a identidade do paciente." action={<PreviewNotice />} /><div className="grid gap-4 xl:grid-cols-4">{stages.map((stage) => <Section key={stage.title} title={stage.title} description={`${stage.count} oportunidades`}><div className="space-y-3">{stage.names.map((name, index) => <div key={name} className="rounded-md border border-border bg-muted/30 p-3"><p className="text-sm font-medium">{name}</p><p className="mt-1 text-xs text-muted-foreground">{index ? "Retorno agendado" : "Último contato hoje"}</p></div>)}</div></Section>)}</div></div>;
}

export function ExamsPage() {
  return <div className="space-y-6"><PageHeader eyebrow="Resultados integrados" title="Exames" description="Solicitações e resultados conectados à linha do tempo de cada paciente." action={<PreviewNotice />} /><Section title="Exames recentes" description="Informações inteiramente fictícias"><div className="divide-y divide-border">{patients.map((patient, index) => <div key={patient.id} className="grid gap-3 py-4 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_160px_130px_auto] sm:items-center"><div className="flex min-w-0 items-center gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-info-soft text-info-foreground"><FlaskConical className="size-4" /></span><div className="min-w-0"><p className="truncate text-sm font-medium">{patient.name}</p><p className="text-xs text-muted-foreground">Painel demonstrativo #{2040 + index}</p></div></div><p className="text-sm text-muted-foreground">{index < 2 ? "02/10/2026" : "30/09/2026"}</p><StatusPill label={index === 0 ? "Aguardando" : "Concluída"} /><Button asChild variant="ghost" size="sm"><Link to="/pacientes/$patientId" params={{ patientId: patient.id }}>Ver paciente</Link></Button></div>)}</div></Section></div>;
}

export function SettingsPage() {
  const groups = [{ icon: Users, title: "Equipe e permissões", text: "Perfis, unidades e acessos da equipe." }, { icon: SlidersHorizontal, title: "Operação da clínica", text: "Tipos de atendimento, salas e jornadas." }, { icon: MessageSquareText, title: "Comunicação", text: "Modelos e preferências de contato." }, { icon: Target, title: "Metas e indicadores", text: "Objetivos comerciais e financeiros." }];
  const previewStates: Array<{ icon: LucideIcon; title: string; status: string }> = [
    { icon: CheckCircle2, title: "Interface navegável", status: "Disponível" },
    { icon: CircleDashed, title: "Dados persistentes", status: "Não conectado" },
    { icon: Settings2, title: "Integrações", status: "Não conectadas" },
  ];
  return <div className="space-y-6"><PageHeader eyebrow="Administração" title="Configurações" description="Estrutura de gestão preparada para a futura operação conectada." action={<PreviewNotice />} /><div className="grid gap-4 sm:grid-cols-2">{groups.map((group) => <div key={group.title} className="flex items-center gap-4 rounded-lg border border-border bg-card p-5 shadow-soft"><div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"><group.icon className="size-5" /></div><div className="min-w-0 flex-1"><p className="font-medium">{group.title}</p><p className="mt-1 text-sm text-muted-foreground">{group.text}</p></div><ArrowRight className="size-4 shrink-0 text-muted-foreground" /></div>)}</div><Section title="Estado da prévia" description="Recursos que serão conectados em etapas futuras"><div className="grid gap-4 sm:grid-cols-3">{previewStates.map(({ icon: ItemIcon, title, status }) => <div key={title} className="rounded-md bg-muted/50 p-4"><ItemIcon className="mb-3 size-5 text-primary" /><p className="text-sm font-medium">{title}</p><p className="mt-1 text-xs text-muted-foreground">{status}</p></div>)}</div></Section></div>;
}
