import { createFileRoute, redirect } from "@tanstack/react-router";
export const Route = createFileRoute("/pacientes/$patientId")({
  beforeLoad: () => {
    throw redirect({ to: "/pacientes" });
  },
});
