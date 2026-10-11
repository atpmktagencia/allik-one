import { createFileRoute } from "@tanstack/react-router";
import { PatientTreatmentPage } from "@/components/clinic/patient-treatment-page";
export const Route = createFileRoute("/pacientes/$patientId")({
  head: () => ({ meta: [{ title: "Tratamento do paciente — Allik One" }] }),
  component: PatientRoute,
});

function PatientRoute() {
  return <PatientTreatmentPage patientId={Route.useParams().patientId} />;
}
