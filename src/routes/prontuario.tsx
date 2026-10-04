import { createFileRoute } from "@tanstack/react-router";
import { RecordsPage } from "@/components/clinic/feature-pages";
export const Route = createFileRoute("/prontuario")({
  head: () => ({
    meta: [
      { title: "Prontuário — Estoque Allik Fortaleza" },
      { name: "description", content: "Registros clínicos organizados por paciente." },
      { property: "og:title", content: "Prontuário — Estoque Allik Fortaleza" },
      { property: "og:description", content: "Registros clínicos organizados por paciente." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RecordsPage,
});
