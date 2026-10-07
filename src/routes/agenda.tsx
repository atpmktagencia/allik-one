import { createFileRoute } from "@tanstack/react-router";
import { AgendaPage } from "@/components/clinic/feature-pages";
export const Route = createFileRoute("/agenda")({
  head: () => ({
    meta: [
      { title: "Agenda — Clinic OS" },
      { name: "description", content: "Agenda clínica integrada por paciente e profissional." },
      { property: "og:title", content: "Agenda — Clinic OS" },
      {
        property: "og:description",
        content: "Agenda clínica integrada por paciente e profissional.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AgendaPage,
});
