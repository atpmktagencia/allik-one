import { createFileRoute } from "@tanstack/react-router";
import { OverviewPage } from "@/components/clinic/overview-page";
export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Visão geral — Clinic OS" },
      { name: "description", content: "Operação clínica integrada, centrada no paciente." },
      { property: "og:title", content: "Visão geral — Clinic OS" },
      { property: "og:description", content: "Operação clínica integrada, centrada no paciente." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: OverviewPage,
});
