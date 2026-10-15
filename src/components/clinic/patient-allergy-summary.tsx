import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { readInventoryResponse } from "@/data/inventory-api";
import { allergyLabel, type AllergySummary, type AllergyStatus } from "@/lib/patient-allergies";
export function PatientAllergySummary({
  patientId,
  summary,
}: {
  patientId: string;
  summary: AllergySummary;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false),
    [pending, setPending] = useState(false),
    [status, setStatus] = useState<AllergyStatus>("UNKNOWN"),
    [reason, setReason] = useState(""),
    [error, setError] = useState("");
  return (
    <section
      aria-label="Situação das alergias"
      className="space-y-2 rounded-2xl border bg-card p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">{allergyLabel(summary)}</p>
        {summary.canAssess && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setStatus(summary.status);
              setReason("");
              setError("");
              setOpen(true);
            }}
          >
            Conferir alergias
          </Button>
        )}
      </div>
      {summary.legacyAllergies.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Inclui registros do cadastro: {summary.legacyAllergies.join(", ")}. Confira e atualize
          esses dados quando necessário.
        </p>
      )}
      {summary.reviewedAt && (
        <p className="text-xs text-muted-foreground">
          Última conferência:{" "}
          {new Date(summary.reviewedAt).toLocaleString("pt-BR", { timeZone: "America/Fortaleza" })}
          {summary.reviewedBy ? ` · ${summary.reviewedBy}` : ""}.
        </p>
      )}
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!pending) setOpen(value);
        }}
      >
        <DialogContent className="clinical-workspace max-h-[90dvh] overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle>Conferir alergias</DialogTitle>
            <DialogDescription>
              Registre a informação obtida na conferência. Esta ação não remove alergias nem inativa
              alertas existentes.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={async (event) => {
              event.preventDefault();
              if (pending) return;
              setPending(true);
              setError("");
              try {
                const response = await fetch("/api/v1/inventory/clinical-alerts", {
                  method: "POST",
                  credentials: "same-origin",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    action: "ASSESS_ALLERGIES",
                    patientId,
                    status,
                    version: summary.version,
                    reason,
                  }),
                });
                await readInventoryResponse(response, "Não foi possível registrar a conferência.");
                await queryClient.invalidateQueries({ queryKey: ["inventory"] });
                setOpen(false);
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : "Falha de conexão.");
              } finally {
                setPending(false);
              }
            }}
          >
            <label className="block space-y-1 text-sm">
              Informação sobre alergias
              <select
                aria-label="Informação sobre alergias"
                disabled={pending}
                value={status}
                className="h-10 w-full rounded-xl border bg-white px-3"
                onChange={(event) => setStatus(event.target.value as AllergyStatus)}
              >
                <option value="UNKNOWN">Não informadas / não foi possível confirmar</option>
                <option value="DENIED" disabled={summary.allergies.length > 0}>
                  Paciente nega alergias
                </option>
                <option value="REPORTED">Paciente relata alergias</option>
              </select>
            </label>
            {summary.allergies.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Há alergias registradas. Revise os registros do cadastro e os alertas ativos antes
                de confirmar ausência de alergias.
              </p>
            )}
            <label className="block space-y-1 text-sm">
              Motivo e referência da conferência
              <textarea
                disabled={pending}
                className="min-h-24 w-full rounded-xl border p-3"
                required
                minLength={10}
                maxLength={500}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button disabled={pending || reason.trim().length < 10}>
              {pending ? "Registrando…" : "Registrar conferência"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
