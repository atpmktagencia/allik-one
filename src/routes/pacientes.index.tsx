import { createFileRoute } from "@tanstack/react-router";
import { PatientsPage } from "@/components/clinic/feature-pages";
export const Route = createFileRoute("/pacientes/")({
  head: () => ({
    meta: [
      { title: "Pacientes — Clinic OS" },
      { name: "description", content: "Base única de pacientes e jornadas de cuidado." },
      { property: "og:title", content: "Pacientes — Clinic OS" },
      { property: "og:description", content: "Base única de pacientes e jornadas de cuidado." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PatientsPage,
});
