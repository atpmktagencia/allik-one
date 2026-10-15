import { createFileRoute } from "@tanstack/react-router";
import { activationResponse } from "@/server/user-admin";
export const Route = createFileRoute("/api/inventory-activation")({
  server: { handlers: { POST: ({ request }) => activationResponse(request) } },
});
