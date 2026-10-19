import { ClipboardList, Files, FlaskConical, LayoutDashboard, Stethoscope } from "lucide-react";

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
}: {
  patient: { fullName: string; internalCode: string; unitName: string };
  section: PatientWorkspaceSection;
  onSelect: (section: PatientWorkspaceSection) => void;
}) {
  return (
    <nav
      aria-label="Seções do paciente"
      className="min-w-0 border-b border-slate-200 bg-white py-2 lg:sticky lg:top-4 lg:self-start lg:border-b-0 lg:border-r lg:pr-3"
    >
      <div className="mb-4 hidden space-y-1 px-3 lg:block">
        <p className="break-words text-sm font-semibold text-slate-900">{patient.fullName}</p>
        <p className="text-xs text-slate-500">{patient.internalCode}</p>
        <p className="break-words text-xs text-slate-500">{patient.unitName}</p>
      </div>
      <ul className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
        {patientWorkspaceSections.map(({ id, label, icon: Icon }) => (
          <li key={id} className="shrink-0">
            <button
              type="button"
              aria-current={section === id ? "page" : undefined}
              onClick={() => onSelect(id)}
              className={`flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 ${section === id ? "bg-teal-50 font-semibold text-teal-800" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"}`}
            >
              <Icon className="size-4 shrink-0" aria-hidden="true" />
              {label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
