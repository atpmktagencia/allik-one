import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  FileHeart,
  FlaskConical,
  HeartHandshake,
  Phone,
  ReceiptText,
  UserRound,
} from "lucide-react";
import { patientTimeline, patients } from "@/data/mock-clinic";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader, PreviewNotice, Section } from "./page-kit";
import { StatusPill } from "./status-pill";

export function PatientDetailPage({ patientId }: { patientId: string }) {
  const patient = patients.find((item) => item.id === patientId);
  if (!patient) {
    return (
      <div className="space-y-6">
        <Button asChild variant="ghost" size="sm" className="-ml-3">
          <Link to="/pacientes">
            <ArrowLeft />
            Pacientes
          </Link>
        </Button>
        <Section title="Paciente não encontrado">
          <p className="text-sm text-muted-foreground">
            Este perfil fictício não está disponível na prévia.
          </p>
        </Section>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-3 -ml-3">
          <Link to="/pacientes">
            <ArrowLeft />
            Pacientes
          </Link>
        </Button>
        <PageHeader
          eyebrow="Patient 360"
          title={patient.name}
          description="Perfil fictício · nenhuma informação pertence a uma pessoa real"
          action={<PreviewNotice />}
        />
      </div>
      <div className="grid gap-4 md:grid-cols-[1.3fr_.7fr]">
        <Section title="Identidade do paciente" description="Referência única em toda a operação">
          <div className="grid gap-5 sm:grid-cols-[auto_1fr]">
            <span className="flex size-16 items-center justify-center rounded-full bg-info-soft font-display text-lg font-semibold text-info-foreground">
              {patient.initials}
            </span>
            <div className="grid gap-4 sm:grid-cols-2">
              <Info label="CPF fictício" value={patient.cpf} />
              <Info label="Telefone fictício" value={patient.phone} />
              <Info label="Idade" value={`${patient.age} anos`} />
              <Info label="Jornada" value={patient.journey} />
            </div>
          </div>
        </Section>
        <Section title="Próxima consulta" description="Contexto assistencial">
          <div className="flex gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-info-soft text-info-foreground">
              <CalendarDays className="size-5" />
            </div>
            <div>
              <p className="font-semibold">{patient.nextVisit}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Acompanhamento · Dra. Helena Prado
              </p>
              <StatusPill label="Confirmada" />
            </div>
          </div>
        </Section>
      </div>
      <Tabs defaultValue="visao">
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="visao">Visão integrada</TabsTrigger>
          <TabsTrigger value="clinico">Dados clínicos</TabsTrigger>
          <TabsTrigger value="administrativo">Administrativo</TabsTrigger>
        </TabsList>
        <TabsContent value="visao" className="mt-5">
          <div className="grid gap-5 xl:grid-cols-[1.15fr_.85fr]">
            <Section title="Linha do tempo" description="Eventos clínicos e administrativos">
              <div className="relative space-y-5 before:absolute before:bottom-2 before:left-[7px] before:top-2 before:w-px before:bg-border">
                {patientTimeline.map((item) => (
                  <div key={item.title} className="relative grid grid-cols-[16px_1fr] gap-3">
                    <span className="mt-1.5 size-3.5 rounded-full border-[3px] border-card bg-primary" />
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium">{item.title}</p>
                        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                          {item.category}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {item.date} · {item.detail}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </Section>
            <div className="space-y-5">
              <Section title="Plano e tratamento" description="Progresso demonstrativo">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Programa de cuidado integrado</p>
                    <p className="mt-1 text-xs text-muted-foreground">2 de 4 etapas concluídas</p>
                  </div>
                  <StatusPill label="Em tratamento" />
                </div>
              </Section>
              <Section title="Acompanhamento" description="Relacionamento com a equipe">
                <div className="space-y-3">
                  <Row icon={HeartHandshake} label="Responsável" value="Dra. Helena Prado" />
                  <Row icon={Phone} label="Último contato" value="WhatsApp · 02/10" />
                  <Row icon={CheckCircle2} label="Próxima ação" value="Confirmar retorno" />
                </div>
              </Section>
            </div>
          </div>
        </TabsContent>
        <TabsContent value="clinico" className="mt-5">
          <div className="grid gap-5 md:grid-cols-3">
            <DetailBlock
              icon={FileHeart}
              title="Registros clínicos"
              text="3 evoluções demonstrativas organizadas na linha do tempo."
            />
            <DetailBlock
              icon={ClipboardList}
              title="Aplicações"
              text="2 sessões fictícias concluídas de um plano com 4 etapas."
            />
            <DetailBlock
              icon={FlaskConical}
              title="Exames e resultados"
              text="2 resultados demonstrativos disponíveis para consulta."
            />
          </div>
        </TabsContent>
        <TabsContent value="administrativo" className="mt-5">
          <div className="grid gap-5 md:grid-cols-3">
            <DetailBlock
              icon={ReceiptText}
              title="Financeiro comercial"
              text="R$ 2.450,00 contratado · saldo fictício de R$ 1.225,00."
            />
            <DetailBlock
              icon={CalendarDays}
              title="Agenda"
              text="Próximo retorno confirmado e dois eventos anteriores."
            />
            <DetailBlock
              icon={UserRound}
              title="Relacionamento"
              text="Origem por indicação e preferência de contato registrada."
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium">{value}</p>
    </div>
  );
}
function Row({ icon: Icon, label, value }: { icon: typeof Phone; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <Icon className="size-4 text-muted-foreground" />
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium">{value}</p>
      </div>
    </div>
  );
}
function DetailBlock({
  icon: Icon,
  title,
  text,
}: {
  icon: typeof Phone;
  title: string;
  text: string;
}) {
  return (
    <Section title={title}>
      <Icon className="mb-4 size-5 text-primary" />
      <p className="text-sm leading-6 text-muted-foreground">{text}</p>
    </Section>
  );
}
