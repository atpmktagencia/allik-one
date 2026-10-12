import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { PatientsPage } from "@/components/clinic/patients-page";

const searchSchema = z
  .object({
    create: z.coerce.boolean().optional(),
    returnTo: z.literal("/agenda").optional(),
  })
  .catch({});

function Page() {
  const search = Route.useSearch();
  return (
    <PatientsPage
      {...(search.create === undefined ? {} : { autoCreate: search.create })}
      {...(search.returnTo ? { returnTo: search.returnTo } : {})}
    />
  );
}

export const Route = createFileRoute("/pacientes/")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Pacientes — Allik One" },
      {
        name: "description",
        content: "Cadastro operacional de pacientes por unidade.",
      },
    ],
  }),
  component: Page,
});
