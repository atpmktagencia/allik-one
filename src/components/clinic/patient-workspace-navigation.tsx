import {
  ClipboardList,
  Files,
  FlaskConical,
  LayoutDashboard,
  Stethoscope,
  History,
  ListChecks,
  ClipboardCheck,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { ClinicalNavigation } from "./clinical-navigation";

const patientWorkspaceSections = [
  { id: "overview", label: "Visão geral", icon: LayoutDashboard },
  { id: "history", label: "Histórico", icon: History },
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
  const itemClass =
    "flex min-h-10 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 text-slate-600 hover:bg-slate-50 hover:text-slate-900";
  return (
    <ClinicalNavigation label="Seções do paciente">
      <span className="sr-only">
        {patient.fullName} · {patient.internalCode} · {patient.unitName}
      </span>
      <ul className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
        {activeAppointmentId && (
          <li className="shrink-0">
            <Link
              aria-label="Atendimento"
              to="/atendimentos/$appointmentId"
              params={{ appointmentId: activeAppointmentId }}
              className={itemClass}
            >
              <Stethoscope className="size-4 shrink-0" aria-hidden="true" />
              <span className="clinical-nav-label">Atendimento</span>
            </Link>
          </li>
        )}
        {patientWorkspaceSections.map(({ id, label, icon: Icon }) => (
          <li key={id} className="shrink-0">
            <button
              type="button"
              aria-label={label}
              aria-current={section === id ? "page" : undefined}
              onClick={() => onSelect(id)}
              className={`${itemClass} ${section === id ? "bg-teal-50 font-semibold !text-teal-800" : ""}`}
            >
              <Icon className="size-4 shrink-0" aria-hidden="true" />
              <span className="clinical-nav-label">{label}</span>
            </button>
          </li>
        ))}
        {onPreconsultation && (
          <li className="shrink-0">
            <button type="button" onClick={onPreconsultation} className={itemClass}>
              <ClipboardCheck className="size-4 shrink-0" aria-hidden="true" />
              <span className="clinical-nav-label">Questionários</span>
            </button>
          </li>
        )}
        {patientId && (
          <li className="shrink-0 lg:mt-4 lg:border-t lg:border-slate-100 lg:pt-3">
            <Link
              aria-label="Tarefas da equipe"
              to="/tarefas"
              search={{ patientId }}
              className={itemClass}
            >
              <ListChecks className="size-4 shrink-0" aria-hidden="true" />
              <span className="clinical-nav-label">Tarefas da equipe</span>
            </Link>
          </li>
        )}
      </ul>
    </ClinicalNavigation>
  );
}
