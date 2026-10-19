import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { PatientTreatmentPage } from "@/components/clinic/patient-treatment-page";
export const Route = createFileRoute("/pacientes/$patientId")({
  head: () => ({ meta: [{ title: "Paciente360º — Allik One" }] }),
  component: PatientRoute,
});

function PatientRoute() {
  const { patientId } = Route.useParams();
  const isTimeline = useRouterState({
    select: (state) => state.location.pathname.endsWith("/prontuario"),
  });
  if (isTimeline) return <Outlet />;
  return <PatientTreatmentPage key={patientId} patientId={patientId} />;
}
