import { createFileRoute } from "@tanstack/react-router";
import { sessionResponse } from "@/server/auth";
export const Route = createFileRoute("/api/inventory-session")({
  server: {
    handlers: {
      GET: ({ request }) => sessionResponse(request),
      POST: ({ request }) => sessionResponse(request),
      DELETE: ({ request }) => sessionResponse(request),
    },
  },
});
