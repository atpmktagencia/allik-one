import { createFileRoute } from "@tanstack/react-router";
import { PatientDemandPage } from "@/components/clinic/patient-demand-page";

export const Route = createFileRoute("/pacientes/demanda")({
  head: () => ({
    meta: [
      { title: "Demanda futura — Allik One" },
      { name: "description", content: "Previsão operacional de demanda por unidade." },
    ],
  }),
  component: PatientDemandPage,
});
