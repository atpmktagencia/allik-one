import { createFileRoute } from "@tanstack/react-router";
import { CatalogPage } from "@/components/clinic/catalog-page";
export const Route = createFileRoute("/estoque/cadastros")({
  head: () => ({ meta: [{ title: "Produtos e sede — Estoque Allik" }] }),
  component: CatalogPage,
});
