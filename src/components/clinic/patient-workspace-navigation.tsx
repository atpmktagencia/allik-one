import {
  ClipboardList,
  Files,
  FlaskConical,
  LayoutDashboard,
  Stethoscope,
  History,
  ListChecks,
  ClipboardCheck,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

const patientWorkspaceSections = [
  { id: "overview", label: "Visão geral", icon: LayoutDashboard },
  { id: "encounters", label: "Consultas", icon: Stethoscope },
  { id: "documents", label: "Documentos", icon: Files },
  { id: "exams", label: "Exames", icon: FlaskConical },
  { id: "treatments", label: "Tratamentos", icon: ClipboardList },
] as const;
export type PatientWorkspaceSection = (typeof patientWorkspaceSections)[number]["id"];

export function PatientWorkspaceNavigation({
  section,
  onSelect,
  patient,
  patientId,
  activeAppointmentId,
  onPreconsultation,
}: {
  patient: { fullName: string; internalCode: string; unitName: string };
  section: PatientWorkspaceSection;
  onSelect: (section: PatientWorkspaceSection) => void;
  patientId?: string;
  activeAppointmentId?: string | undefined;
  onPreconsultation?: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const itemClass =
    "flex min-h-10 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 text-slate-600 hover:bg-slate-50 hover:text-slate-900";
  return (
    <nav
      aria-label="Seções do paciente"
      className={`min-w-0 rounded-[10px] border border-slate-200/80 bg-white p-2 lg:sticky lg:top-4 lg:self-start ${collapsed ? "lg:w-[62px]" : "lg:w-[206px]"}`}
    >
      <div className="mb-2 hidden items-center justify-between gap-2 px-2 lg:flex">
        <p
          className={`text-[10px] font-medium uppercase tracking-wide text-slate-400 ${collapsed ? "sr-only" : ""}`}
        >
          Prontuário
        </p>
        <button
          type="button"
          className="rounded p-1 text-slate-500 hover:bg-slate-50"
          aria-label={
            collapsed ? "Expandir navegação do paciente" : "Recolher navegação do paciente"
          }
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
        </button>
      </div>
      <span className="sr-only">
        {patient.fullName} · {patient.internalCode} · {patient.unitName}
      </span>
      <ul className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
        {activeAppointmentId && (
          <li className="shrink-0">
            <Link
              to="/atendimentos/$appointmentId"
              params={{ appointmentId: activeAppointmentId }}
              className={itemClass}
            >
              <Stethoscope className="size-4 shrink-0" aria-hidden="true" />
              <span className={collapsed ? "lg:sr-only" : ""}>Atendimento</span>
            </Link>
          </li>
        )}
        {patientWorkspaceSections.map(({ id, label, icon: Icon }) => (
          <li key={id} className="shrink-0">
            <button
              type="button"
              aria-current={section === id ? "page" : undefined}
              onClick={() => onSelect(id)}
              className={`${itemClass} ${section === id ? "bg-teal-50 font-semibold !text-teal-800" : ""}`}
            >
              <Icon className="size-4 shrink-0" aria-hidden="true" />
              <span className={collapsed ? "lg:sr-only" : ""}>{label}</span>
            </button>
          </li>
        ))}
        {patientId && (
          <li className="shrink-0">
            <Link
              to="/pacientes/$patientId/prontuario"
              params={{ patientId }}
              className={itemClass}
            >
              <History className="size-4 shrink-0" aria-hidden="true" />
              <span className={collapsed ? "lg:sr-only" : ""}>Histórico</span>
            </Link>
          </li>
        )}
        {onPreconsultation && (
          <li className="shrink-0">
            <button type="button" onClick={onPreconsultation} className={itemClass}>
              <ClipboardCheck className="size-4 shrink-0" aria-hidden="true" />
              <span className={collapsed ? "lg:sr-only" : ""}>Questionários</span>
            </button>
          </li>
        )}
        {patientId && (
          <li className="shrink-0 lg:mt-4 lg:border-t lg:border-slate-100 lg:pt-3">
            <Link to="/tarefas" search={{ patientId }} className={itemClass}>
              <ListChecks className="size-4 shrink-0" aria-hidden="true" />
              <span className={collapsed ? "lg:sr-only" : ""}>Tarefas da equipe</span>
            </Link>
          </li>
        )}
      </ul>
    </nav>
  );
}
