import { createFileRoute } from "@tanstack/react-router";
import { CareEncounterPage } from "@/components/clinic/care-encounter-page";

export const Route = createFileRoute("/atendimentos/$appointmentId")({
  head: () => ({ meta: [{ title: "Atendimento — Allik One" }] }),
  component: AppointmentRoute,
});

function AppointmentRoute() {
  return <CareEncounterPage appointmentId={Route.useParams().appointmentId} />;
}
