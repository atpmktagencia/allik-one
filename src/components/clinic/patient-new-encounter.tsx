import { useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { readInventoryResponse } from "@/data/inventory-api";

type Options = {
  currentUserId?: string;
  professionals: Array<{ id: string; name: string; unitId: string | null }>;
  rooms: Array<{ id: string; name: string; unitId: string }>;
  careTypes: Array<{ code: string; name: string }>;
  canManage: boolean;
};
/** Creates a real encounter through the existing scoped scheduling API; never bypasses conflicts. */
export function PatientNewEncounter({ patientId, unitId }: { patientId: string; unitId: string }) {
  const [open, setOpen] = useState(false),
    [options, setOptions] = useState<Options | null>(null);
  const [error, setError] = useState(""),
    [pending, setPending] = useState(false),
    [loading, setLoading] = useState(false);
  const [professional, setProfessional] = useState(""),
    [room, setRoom] = useState(""),
    [type, setType] = useState("CONSULTATION");
  const [duration, setDuration] = useState("30"),
    [notes, setNotes] = useState("");
  const busy = useRef(false),
    operationId = useRef("");
  const fieldId = useId(),
    navigate = useNavigate(),
    client = useQueryClient();
  useEffect(() => {
    if (!open) return;
    let canceled = false;
    setLoading(true);
    setError("");
    setOptions(null);
    operationId.current = crypto.randomUUID();
    const now = new Date(),
      end = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const params = new URLSearchParams({
      from: now.toISOString(),
      to: end.toISOString(),
      unitId,
      patientId,
    });
    void fetch(`/api/v1/inventory/care-appointments?${params}`, { credentials: "same-origin" })
      .then((r) =>
        readInventoryResponse<Options>(r, "Não foi possível carregar profissionais e salas."),
      )
      .then(({ data }) => {
        if (canceled) return;
        if (!data?.canManage)
          throw new Error("Seu perfil não permite criar atendimentos nesta unidade.");
        const rooms = data.rooms.filter((candidate) => candidate.unitId === unitId);
        setOptions({ ...data, rooms });
        const available = [...new Map(data.professionals.map((p) => [p.id, p])).values()];
        setProfessional(
          available.some((p) => p.id === data.currentUserId)
            ? data.currentUserId!
            : available.length === 1
              ? available[0]!.id
              : "",
        );
        setRoom(rooms.length === 1 ? rooms[0]!.name : "");
        setType(
          data.careTypes.some((t) => t.code === "CONSULTATION")
            ? "CONSULTATION"
            : (data.careTypes[0]?.code ?? ""),
        );
      })
      .catch((cause) => {
        if (!canceled) setError(cause instanceof Error ? cause.message : "Falha de conexão.");
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [open, patientId, unitId]);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Plus /> Nova consulta
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy.current) setOpen(value);
        }}
      >
        <DialogContent className="clinical-workspace max-h-[90dvh] overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle>Nova consulta</DialogTitle>
            <DialogDescription>
              Crie um atendimento para este paciente agora, inclusive para uma receita ou
              solicitação extra. Profissional, sala e conflitos seguem as regras da agenda.
            </DialogDescription>
          </DialogHeader>
          {loading && <p role="status">Carregando profissionais e salas…</p>}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {options && (
            <form
              className="space-y-4"
              onSubmit={async (event) => {
                event.preventDefault();
                if (busy.current) return;
                busy.current = true;
                setPending(true);
                setError("");
                try {
                  const start = new Date(),
                    end = new Date(start.getTime() + Number(duration) * 60000);
                  const response = await fetch("/api/v1/inventory/care-appointments", {
                    method: "POST",
                    credentials: "same-origin",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      action: "CREATE",
                      id: operationId.current,
                      patientId,
                      unitId,
                      professionalUserId: professional,
                      careType: type,
                      startsAt: start.toISOString(),
                      endsAt: end.toISOString(),
                      room,
                      chair: null,
                      resourceName: null,
                      notes,
                      status: "SCHEDULED",
                      version: 0,
                      reason: "Consulta criada a partir do paciente, sem agendamento prévio.",
                    }),
                  });
                  const result = await readInventoryResponse<{ id: string }>(
                    response,
                    "Não foi possível criar o atendimento.",
                  );
                  if (!result.data?.id) throw new Error("O servidor não confirmou o atendimento.");
                  await client.invalidateQueries({ queryKey: ["inventory"] });
                  setOpen(false);
                  await navigate({
                    to: "/atendimentos/$appointmentId",
                    params: { appointmentId: result.data.id },
                  });
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : "Falha de conexão.");
                } finally {
                  busy.current = false;
                  setPending(false);
                }
              }}
            >
              <fieldset disabled={pending} className="space-y-4">
                <div className="space-y-1">
                  <label htmlFor={`${fieldId}-professional`}>Profissional responsável</label>
                  <select
                    id={`${fieldId}-professional`}
                    required
                    className="h-10 w-full rounded-xl border px-3"
                    value={professional}
                    onChange={(e) => setProfessional(e.target.value)}
                  >
                    <option value="">Selecione</option>
                    {[...new Map(options.professionals.map((p) => [p.id, p])).values()].map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label htmlFor={`${fieldId}-type`}>Tipo de atendimento</label>
                  <select
                    id={`${fieldId}-type`}
                    required
                    className="h-10 w-full rounded-xl border px-3"
                    value={type}
                    onChange={(e) => setType(e.target.value)}
                  >
                    <option value="">Selecione</option>
                    {options.careTypes.map((t) => (
                      <option key={t.code} value={t.code}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label htmlFor={`${fieldId}-room`}>Sala de atendimento</label>
                  <select
                    id={`${fieldId}-room`}
                    required
                    className="h-10 w-full rounded-xl border px-3"
                    value={room}
                    onChange={(e) => setRoom(e.target.value)}
                  >
                    <option value="">Selecione</option>
                    {options.rooms.map((r) => (
                      <option key={r.id} value={r.name}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label htmlFor={`${fieldId}-duration`}>Duração prevista</label>
                  <select
                    id={`${fieldId}-duration`}
                    className="h-10 w-full rounded-xl border px-3"
                    value={duration}
                    onChange={(e) => setDuration(e.target.value)}
                  >
                    {[15, 30, 45, 60].map((minutes) => (
                      <option key={minutes} value={minutes}>
                        {minutes} minutos
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label htmlFor={`${fieldId}-notes`}>Observações</label>
                  <textarea
                    id={`${fieldId}-notes`}
                    maxLength={1000}
                    className="min-h-20 w-full rounded-xl border p-3"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>
                {(!options.rooms.length ||
                  !options.professionals.length ||
                  !options.careTypes.length) && (
                  <p className="text-sm text-muted-foreground">
                    Complete os profissionais, tipos de atendimento e salas em Configurações antes
                    de criar a consulta.
                  </p>
                )}
                <Button type="submit" disabled={pending || !professional || !room || !type}>
                  {pending ? "Criando…" : "Criar e abrir atendimento"}
                </Button>
              </fieldset>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
