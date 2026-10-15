import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export type PatientEncounterSummary = {
  id: string;
  startsAt: string;
  status: string;
  unitName: string;
  professionalName: string;
  careTypeName: string;
  hasOwnDraft: boolean;
  note: null | {
    id: string;
    evolution: string;
    conduct: string;
    clinicalPlan: string;
    returnRecommendation: string;
    returnOn: string | null;
    authorName: string;
  };
  prescription: null | {
    id: string;
    items: Array<{
      id: string;
      medicationName: string;
      doseQuantity: number;
      doseUnit: string;
      doseUnitOther?: string;
      route: string;
    }>;
    generalInstructions: string;
  };
  documents: Array<{ id: string; title: string; type: string }>;
};
const careTypes: Record<string, string> = {
  FIRST_VISIT: "Primeira consulta",
  FOLLOW_UP: "Retorno",
  CONSULTATION: "Consulta",
  TELECONSULTATION: "Teleconsulta",
  INJECTABLE: "Injetável",
  OTHER: "Outro atendimento",
};
const statuses: Record<string, string> = {
  SCHEDULED: "Agendado",
  CONFIRMED: "Confirmado",
  CHECKED_IN: "Paciente presente",
  IN_PROGRESS: "Em atendimento",
  COMPLETED: "Concluído",
  CANCELED: "Cancelado",
  NO_SHOW: "Não compareceu",
};
export function PatientEncounterHistory({ encounters }: { encounters: PatientEncounterSummary[] }) {
  return (
    <section aria-label="Resumo das consultas" className="space-y-4 rounded-2xl border bg-card p-5">
      <div>
        <h2 className="font-semibold">Resumo das consultas</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Últimos 50 atendimentos nas unidades autorizadas. Prescrever não significa aplicar ou
          consumir estoque.
        </p>
      </div>
      {!encounters.length && (
        <p className="text-sm text-muted-foreground">
          Nenhuma consulta registrada para este paciente.
        </p>
      )}
      {encounters.map((encounter) => (
        <article key={encounter.id} className="space-y-3 rounded-xl border p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-medium">
                {careTypes[encounter.careTypeName] ?? encounter.careTypeName}
              </h3>
              <p className="text-xs text-muted-foreground">
                {new Intl.DateTimeFormat("pt-BR", {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: "America/Fortaleza",
                }).format(new Date(encounter.startsAt))}{" "}
                · {encounter.unitName} · {encounter.professionalName}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{statuses[encounter.status] ?? encounter.status}</Badge>
              <Button asChild variant="outline" size="sm">
                <Link to="/atendimentos/$appointmentId" params={{ appointmentId: encounter.id }}>
                  Abrir atendimento
                </Link>
              </Button>
            </div>
          </div>
          {encounter.note ? (
            <div className="space-y-3 text-sm">
              {[
                ["Evolução", encounter.note.evolution],
                ["Conduta", encounter.note.conduct],
                ["Plano clínico", encounter.note.clinicalPlan],
                ["Retorno recomendado", encounter.note.returnRecommendation],
              ]
                .filter(([, value]) => value)
                .map(([label, value]) => (
                  <div key={label}>
                    <p className="text-xs font-medium text-muted-foreground">{label}</p>
                    <p className="whitespace-pre-wrap break-words">{value}</p>
                  </div>
                ))}
              {encounter.note.returnOn && (
                <p>Retorno sugerido: {encounter.note.returnOn.split("-").reverse().join("/")}</p>
              )}
              <p className="text-xs text-muted-foreground">
                Evolução finalizada por {encounter.note.authorName}.
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {encounter.hasOwnDraft
                ? "Sua evolução está salva como rascunho. Abra o atendimento para revisar e finalizar."
                : "Sem evolução clínica finalizada neste atendimento."}
            </p>
          )}
          {encounter.prescription && (
            <div className="text-sm">
              <h4 className="text-xs font-medium text-muted-foreground">
                Prescrição de injetáveis finalizada
              </h4>
              <ul className="list-inside list-disc space-y-1">
                {encounter.prescription.items.map((item) => (
                  <li key={item.id}>
                    {item.medicationName} · {item.doseQuantity}{" "}
                    {item.doseUnitOther || item.doseUnit} · {item.route}
                  </li>
                ))}
              </ul>
              {encounter.prescription.generalInstructions && (
                <p className="mt-2 whitespace-pre-wrap break-words">
                  {encounter.prescription.generalInstructions}
                </p>
              )}
            </div>
          )}
          {encounter.documents.length > 0 && (
            <div className="text-sm">
              <h4 className="text-xs font-medium text-muted-foreground">Documentos finalizados</h4>
              <ul className="list-inside list-disc">
                {encounter.documents.map((document) => (
                  <li key={document.id}>{document.title}</li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-muted-foreground">
                Abra o atendimento para consultar os documentos completos.
              </p>
            </div>
          )}
        </article>
      ))}
    </section>
  );
}
