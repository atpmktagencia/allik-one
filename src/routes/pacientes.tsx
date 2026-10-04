import { createFileRoute } from "@tanstack/react-router";
import { PatientsPage } from "@/components/clinic/feature-pages";
export const Route = createFileRoute("/pacientes")({
  head: () => ({
    meta: [
      { title: "Pacientes — Estoque Allik Fortaleza" },
      { name: "description", content: "Base única de pacientes e jornadas de cuidado." },
      { property: "og:title", content: "Pacientes — Estoque Allik Fortaleza" },
      { property: "og:description", content: "Base única de pacientes e jornadas de cuidado." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PatientsPage,
});
