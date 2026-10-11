import { createFileRoute } from "@tanstack/react-router";
import { PatientsPage } from "@/components/clinic/patients-page";

export const Route = createFileRoute("/pacientes/")({
  head: () => ({
    meta: [
      { title: "Pacientes — Allik One" },
      {
        name: "description",
        content: "Cadastro operacional de pacientes por unidade.",
      },
    ],
  }),
  component: PatientsPage,
});
