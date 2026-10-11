import { createFileRoute } from "@tanstack/react-router";
import { PatientsPage } from "@/components/clinic/patients-page";
export const Route = createFileRoute("/pacientes")({
  head: () => ({
    meta: [
      { title: "Pacientes — Allik One" },
      { name: "description", content: "Cadastro operacional de pacientes por unidade." },
      { property: "og:title", content: "Pacientes — Allik One" },
      { property: "og:description", content: "Cadastro operacional de pacientes por unidade." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PatientsPage,
});
