import { createFileRoute } from "@tanstack/react-router";
import { CatalogPage } from "@/components/clinic/catalog-page";
export const Route = createFileRoute("/estoque/cadastros")({
  head: () => ({ meta: [{ title: "Produtos e locais — Estoque Allik Fortaleza" }] }),
  component: CatalogPage,
});
