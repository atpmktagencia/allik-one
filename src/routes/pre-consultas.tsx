import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { PreconsultationPanel } from "@/components/clinic/preconsultation-panel";
import { PageHeader } from "@/components/clinic/page-kit";
const search = z.object({ patientId: z.string().uuid().optional() }).catch({});
function Page() {
  const { patientId } = Route.useSearch();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Pré-consultas"
        description="Prepare questionários e acompanhe as respostas opcionais dos pacientes."
      />
      <PreconsultationPanel key={patientId ?? "all"} {...(patientId ? { patientId } : {})} />
    </div>
  );
}
export const Route = createFileRoute("/pre-consultas")({
  validateSearch: search,
  head: () => ({ meta: [{ title: "Pré-consultas — Allik One" }] }),
  component: Page,
});
