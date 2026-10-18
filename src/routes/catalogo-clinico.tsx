import { createFileRoute } from "@tanstack/react-router";
import { EngineCatalogPanel } from "@/components/clinic/engine-catalog-panel";
import { PageHeader } from "@/components/clinic/page-kit";
function Page() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Catálogo clínico"
        description="Ativos, medicamentos, serviços, vínculos explícitos e preços de venda por unidade."
      />
      <EngineCatalogPanel />
    </div>
  );
}
export const Route = createFileRoute("/catalogo-clinico")({
  head: () => ({ meta: [{ title: "Catálogo clínico — Allik One" }] }),
  component: Page,
});
