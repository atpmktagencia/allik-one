import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  ClipboardList,
  FileText,
  History,
  ReceiptText,
  Stethoscope,
  UserRound,
} from "lucide-react";

export type ClinicalLongitudinalSection =
  "encounter" | "history" | "documents" | "treatments" | "questionnaires" | "budgets";

type ClinicalLongitudinalNavProps = {
  patientId: string;
  open: boolean;
  onCloseMobile: () => void;
  onSelect: (section: ClinicalLongitudinalSection) => void;
};

const items: Array<{
  section: ClinicalLongitudinalSection;
  label: string;
  icon: typeof ClipboardList;
  hint?: string;
}> = [
  { section: "encounter", label: "Atendimento", icon: ClipboardList },
  { section: "history", label: "Histórico", icon: History },
  {
    section: "documents",
    label: "Documentos",
    icon: FileText,
    hint: "Exames, receitas e solicitações",
  },
  { section: "treatments", label: "Tratamentos", icon: Stethoscope },
  { section: "questionnaires", label: "Questionários", icon: ClipboardList },
  { section: "budgets", label: "Orçamentos", icon: ReceiptText },
];

export function ClinicalLongitudinalNav({
  patientId,
  open,
  onCloseMobile,
  onSelect,
}: ClinicalLongitudinalNavProps) {
  const select = (section: ClinicalLongitudinalSection) => {
    onSelect(section);
    onCloseMobile();
  };

  return (
    <aside
      className={`clinical-longitudinal-nav ${open ? "block" : "hidden"} lg:block`}
      aria-label="Navegação longitudinal do paciente"
    >
      <nav className="space-y-1">
        <button
          type="button"
          onClick={() => select("encounter")}
          className="clinical-longitudinal-nav-item clinical-longitudinal-nav-item-active"
          aria-current="page"
        >
          <ClipboardList className="size-4 shrink-0" />
          Atendimento
        </button>
        <Link
          to="/pacientes/$patientId"
          params={{ patientId }}
          onClick={onCloseMobile}
          className="clinical-longitudinal-nav-item"
        >
          <UserRound className="size-4 shrink-0" />
          Visão geral
        </Link>
        {items.slice(1).map((item) => (
          <button
            key={item.section}
            type="button"
            onClick={() => select(item.section)}
            className="clinical-longitudinal-nav-item"
          >
            <item.icon className="size-4 shrink-0" />
            <span className="min-w-0">
              <span className="block truncate">{item.label}</span>
              {item.hint ? (
                <span className="block truncate text-[10px] font-normal text-muted-foreground">
                  {item.hint}
                </span>
              ) : null}
            </span>
          </button>
        ))}
        <div className="clinical-longitudinal-nav-divider" />
        <Link to="/agenda" onClick={onCloseMobile} className="clinical-longitudinal-nav-item">
          <ArrowLeft className="size-4 shrink-0" />
          Voltar à agenda
        </Link>
      </nav>
    </aside>
  );
}
