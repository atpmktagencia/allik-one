import { createFileRoute } from "@tanstack/react-router";
import { inventoryResponse } from "@/server/inventory";
import { receivingResponse } from "@/server/receiving";
import { purchasingResponse } from "@/server/purchases";
import { stockOperationResponse } from "@/server/stock-operations";
import { applicationResponse } from "@/server/applications";

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
        if (new URL(request.url).pathname.replace(/\/$/, "") === "/api/v1/inventory/applications")
          return applicationResponse(request);
        const name = resource(request);
        return name === "suppliers" || name === "purchases"
          ? purchasingResponse(request, name)
          : inventoryResponse(request);
      },
      POST: ({ request }) => {
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
