import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { CareTasksPanel } from "@/components/clinic/care-tasks-panel";
import { PageHeader } from "@/components/clinic/page-kit";
const search = z.object({ patientId: z.string().uuid().optional() }).catch({});
function Page() {
  const { patientId } = Route.useSearch();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Tarefas da equipe"
        description="Organize retornos, exames, contatos e documentos por paciente."
      />
      <CareTasksPanel key={patientId ?? "all"} {...(patientId ? { patientId } : {})} />
    </div>
  );
}
export const Route = createFileRoute("/tarefas")({
  validateSearch: search,
  head: () => ({ meta: [{ title: "Tarefas — Allik One" }] }),
  component: Page,
});
