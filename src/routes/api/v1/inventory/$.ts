import { createFileRoute } from "@tanstack/react-router";
import { inventoryResponse } from "@/server/inventory";
export const Route = createFileRoute("/api/v1/inventory/$")({
  server: { handlers: { GET: ({ request }) => inventoryResponse(request) } },
});
