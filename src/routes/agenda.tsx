import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { CareAppointmentsPage } from "@/components/clinic/care-appointments-page";

const searchSchema = z.object({ patientId: z.string().uuid().optional() }).catch({});

function Page() {
  const { patientId } = Route.useSearch();
  return <CareAppointmentsPage {...(patientId ? { preselectedPatientId: patientId } : {})} />;
}

export const Route = createFileRoute("/agenda")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Agendamentos — Allik One" },
      { name: "description", content: "Agenda de atendimentos por unidade e profissional." },
    ],
  }),
  component: Page,
});
