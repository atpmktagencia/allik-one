import { createFileRoute } from "@tanstack/react-router";
import { PreconsultationPublic } from "@/components/clinic/preconsultation-public";
export const Route = createFileRoute("/preconsulta")({
  head: () => ({
    meta: [
      { title: "Pré-consulta — Allik One" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: PreconsultationPublic,
});
