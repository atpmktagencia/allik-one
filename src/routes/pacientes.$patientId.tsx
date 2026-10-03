import { createFileRoute } from "@tanstack/react-router";
import { PatientDetailPage } from "@/components/clinic/patient-detail";
export const Route = createFileRoute("/pacientes/$patientId")({ head: () => ({ meta: [{ title: "Patient 360 — Clinic OS" }, { name: "description", content: "Visão integrada e fictícia da jornada de um paciente." }, { property: "og:title", content: "Patient 360 — Clinic OS" }, { property: "og:description", content: "Visão integrada e fictícia da jornada de um paciente." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" }] }), component: PatientRoute });
function PatientRoute() { const { patientId } = Route.useParams(); return <PatientDetailPage patientId={patientId} />; }
