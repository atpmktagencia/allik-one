import { createFileRoute } from "@tanstack/react-router";
import { PatientTimelinePage } from "@/components/clinic/patient-timeline-page";

export const Route = createFileRoute("/pacientes/$patientId/prontuario")({
  head: () => ({ meta: [{ title: "Prontuário do paciente — Allik One" }] }),
  component: PatientTimelineRoute,
});

function PatientTimelineRoute() {
  return <PatientTimelinePage patientId={Route.useParams().patientId} />;
}
