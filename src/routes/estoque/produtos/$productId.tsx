import { createFileRoute } from "@tanstack/react-router";
import { ProductDetailPage } from "@/components/clinic/stock-ui";

export const Route = createFileRoute("/estoque/produtos/$productId")({
  head: () => ({ meta: [{ title: "Produto — Estoque — Clinic OS" }] }),
  component: ProductRoute,
});

function ProductRoute() {
  const { productId } = Route.useParams();
  return <ProductDetailPage productId={productId} />;
}
