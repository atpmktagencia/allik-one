import { createFileRoute } from "@tanstack/react-router";
import { previewLogin } from "@/server/auth";
export const Route = createFileRoute("/api/inventory-session")({
  server: { handlers: { POST: ({ request }) => previewLogin(request) } },
});
