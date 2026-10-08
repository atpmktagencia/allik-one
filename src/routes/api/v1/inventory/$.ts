import { createFileRoute } from "@tanstack/react-router";
import { inventoryResponse } from "@/server/inventory";
import { receivingResponse } from "@/server/receiving";
import { purchasingResponse } from "@/server/purchases";
import { stockOperationResponse } from "@/server/stock-operations";
import { applicationResponse } from "@/server/applications";
import { lotTraceResponse } from "@/server/lot-trace";
import { supplierCatalogResponse } from "@/server/supplier-catalog";
import { catalogResponse } from "@/server/catalog";
import { salePricesResponse } from "@/server/sale-prices";
import { userAdminResponse } from "@/server/user-admin";
import { writeOffResponse } from "@/server/write-offs";
import { integrationCredentialResponse } from "@/server/integration-credentials";
import { pricingResponse } from "@/server/pricing";

function catalogResource(request: Request) {
  const path = new URL(request.url).pathname.replace(/\/$/, "");
  if (path === "/api/v1/inventory/catalog/products") return "products";
  if (path === "/api/v1/inventory/catalog/locations") return "locations";
  if (path === "/api/v1/inventory/catalog/history") return "history";
  return undefined;
}

function resource(request: Request) {
  const path = new URL(request.url).pathname.replace(/\/$/, "");
  return path === "/api/v1/inventory/suppliers"
    ? "suppliers"
    : path === "/api/v1/inventory/purchases"
      ? "purchases"
      : undefined;
}
export const Route = createFileRoute("/api/v1/inventory/$")({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (new URL(request.url).pathname.replace(/\/$/, "") === "/api/v1/inventory/pricing")
          return pricingResponse(request);
        if (
          new URL(request.url).pathname.replace(/\/$/, "") ===
          "/api/v1/inventory/integration-credentials"
        )
          return integrationCredentialResponse(request);
        if (new URL(request.url).pathname.replace(/\/$/, "") === "/api/v1/inventory/users")
          return userAdminResponse(request);
        if (new URL(request.url).pathname.replace(/\/$/, "") === "/api/v1/inventory/sale-prices")
          return salePricesResponse(request);
        if (
          /\/inventory\/vendor(?:s|-catalog|-history|-orders)\/?$/.test(
            new URL(request.url).pathname,
          )
        )
          return supplierCatalogResponse(request);
        const catalog = catalogResource(request);
        if (catalog) return catalogResponse(request, catalog);
        if (new URL(request.url).pathname.startsWith("/api/v1/inventory/trace/"))
          return lotTraceResponse(request);
        if (new URL(request.url).pathname.replace(/\/$/, "") === "/api/v1/inventory/applications")
          return applicationResponse(request);
        const name = resource(request);
        return name === "suppliers" || name === "purchases"
          ? purchasingResponse(request, name)
          : inventoryResponse(request);
      },
      POST: ({ request }) => {
        if (new URL(request.url).pathname.replace(/\/$/, "") === "/api/v1/inventory/pricing")
          return pricingResponse(request);
        if (
          new URL(request.url).pathname.replace(/\/$/, "") ===
          "/api/v1/inventory/integration-credentials"
        )
          return integrationCredentialResponse(request);
        if (new URL(request.url).pathname.replace(/\/$/, "") === "/api/v1/inventory/write-offs")
          return writeOffResponse(request);
        if (new URL(request.url).pathname.replace(/\/$/, "") === "/api/v1/inventory/users")
          return userAdminResponse(request);
        if (
          /\/inventory\/vendor(?:s|-catalog|-history|-orders)\/?$/.test(
            new URL(request.url).pathname,
          )
        )
          return supplierCatalogResponse(request);
        const catalog = catalogResource(request);
        if (catalog) return catalogResponse(request, catalog);
        const name = resource(request);
        if (name === "suppliers" || name === "purchases") return purchasingResponse(request, name);
        const path = new URL(request.url).pathname.replace(/\/$/, "");
        if (path === "/api/v1/inventory/applications") return applicationResponse(request);
        if (path === "/api/v1/inventory/transfers")
          return stockOperationResponse(request, "TRANSFER");
        if (path === "/api/v1/inventory/adjustments")
          return stockOperationResponse(request, "ADJUSTMENT");
        return new URL(request.url).pathname.replace(/\/$/, "") === "/api/v1/inventory/receipts"
          ? receivingResponse(request)
          : Response.json({ error: "Recurso não encontrado." }, { status: 404 });
      },
    },
  },
});
