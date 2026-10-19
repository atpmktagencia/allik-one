import type { ReactNode } from "react";
import { HeartPulse, Stethoscope, TriangleAlert } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import "./clinical-workspace.css";

export type ClinicalPatientHeaderProps = {
  name: string;
  code?: string;
  unitName?: string;
  birthDate?: string | null;
  secondaryInfo?: ReactNode;
  vitals?: ReactNode;
  allergies?: ReactNode;
  diagnoses?: ReactNode;
  actions?: ReactNode;
};

/** Displays persisted clinical data supplied by its caller; no inferred clinical defaults. */
export function ClinicalPatientHeader({
  name,
  code,
  unitName,
  birthDate,
  secondaryInfo,
  vitals,
  allergies,
  diagnoses,
  actions,
}: ClinicalPatientHeaderProps) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toLocaleUpperCase("pt-BR");
  const displayBirthDate = birthDate?.match(/^\d{4}-\d{2}-\d{2}$/)
    ? birthDate.split("-").reverse().join("/")
    : birthDate;
  return (
    <section className="clinical-patient-header" aria-label="Resumo clínico do paciente">
      <div className="clinical-patient-identity">
        <Avatar className="size-14 shrink-0">
          <AvatarFallback className="bg-[#e6f4f5] text-lg font-medium text-primary">
            {initials || "P"}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-foreground" title={name}>
            {name}
          </p>
          {secondaryInfo && (
            <div className="mt-1 text-xs text-muted-foreground">{secondaryInfo}</div>
          )}
          {displayBirthDate && (
            <p className="mt-1 text-xs text-muted-foreground">Nascimento: {displayBirthDate}</p>
          )}
          {(code || unitName) && (
            <p className="mt-1 text-xs text-muted-foreground">
              {[code && `ID ${code}`, unitName].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
      </div>
      <div className="clinical-header-section">
        <HeartPulse className="clinical-header-icon" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 className="clinical-header-section-title">Sinais vitais</h2>
          <div className="clinical-header-section-body">
            {vitals ?? (
              <p className="text-xs text-muted-foreground">Sem sinais vitais registrados.</p>
            )}
          </div>
        </div>
      </div>
      <div className="clinical-header-section">
        <TriangleAlert className="clinical-header-icon clinical-allergy-icon" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 className="clinical-header-section-title">Alergias</h2>
          <div className="clinical-header-section-body">
            {allergies ?? (
              <p className="text-xs text-muted-foreground">Consulte o registro de alergias.</p>
            )}
          </div>
        </div>
      </div>
      <div className="clinical-header-section">
        <Stethoscope className="clinical-header-icon" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 className="clinical-header-section-title">Diagnósticos e hipóteses</h2>
          <div className="clinical-header-section-body">
            {diagnoses ?? (
              <p className="text-xs text-muted-foreground">
                Sem diagnósticos registrados neste contexto.
              </p>
            )}
          </div>
        </div>
        {actions && <div className="clinical-header-actions">{actions}</div>}
      </div>
    </section>
  );
}
