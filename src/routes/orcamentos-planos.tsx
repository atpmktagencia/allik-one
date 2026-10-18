import { createFileRoute } from "@tanstack/react-router";
import { PlanQuotesDesk } from "@/components/clinic/plan-quote-panel";
import { PageHeader } from "@/components/clinic/page-kit";
function Page() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Orçamentos estimados"
        description="Snapshots comerciais, valores conhecidos e pendências explícitas. Sem aprovação ou cobrança automática."
      />
      <PlanQuotesDesk />
    </div>
  );
}
export const Route = createFileRoute("/orcamentos-planos")({
  head: () => ({ meta: [{ title: "Orçamentos estimados — Allik One" }] }),
  component: Page,
});
