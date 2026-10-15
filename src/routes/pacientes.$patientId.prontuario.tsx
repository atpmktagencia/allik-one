import { createFileRoute } from "@tanstack/react-router";
import { PatientTimelinePage } from "@/components/clinic/patient-timeline-page";

export const Route = createFileRoute("/pacientes/$patientId/prontuario")({
  head: () => ({ meta: [{ title: "Prontuário do paciente — Allik One" }] }),
  component: PatientTimelineRoute,
});

function PatientTimelineRoute() {
  const { patientId } = Route.useParams();
  return <PatientTimelinePage key={patientId} patientId={patientId} />;
}
