import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { idealTargetDraft, type IdealTargetDraft } from "@/lib/laboratory-longitudinal-view";

export function LaboratoryIdealEditor({
  biomarker,
  name,
  modality,
  unit,
  draft,
  onDraft,
  onClose,
}: {
  biomarker: string;
  name: string;
  modality: string;
  unit: string | null;
  draft?: IdealTargetDraft | undefined;
  onDraft: (draft: IdealTargetDraft) => void;
  onClose: () => void;
}) {
  const [minimum, setMinimum] = useState(draft ? String(draft.minimum) : "");
  const [maximum, setMaximum] = useState(draft ? String(draft.maximum) : "");
  const [scope, setScope] = useState<IdealTargetDraft["scope"]>(draft?.scope ?? "PATIENT");
  const [reason, setReason] = useState(draft?.reason ?? "");
  const [effectiveOn, setEffectiveOn] = useState(
    draft?.effectiveOn ?? new Date().toISOString().slice(0, 10),
  );
  const [error, setError] = useState("");
  const save = () => {
    const parse = (s: string) =>
      /^[+-]?\d+(?:[.,]\d+)?$/.test(s.trim()) ? Number(s.replace(",", ".")) : NaN;
    const value = idealTargetDraft.safeParse({
      biomarker,
      modality,
      unit: unit ?? "",
      minimum: parse(minimum),
      maximum: parse(maximum),
      scope,
      reason,
      effectiveOn,
      active: true,
    });
    if (!value.success) {
      setError(
        "Informe limites válidos, unidade, vigência e justificativa de pelo menos 10 caracteres. Mínimo deve ser menor ou igual ao máximo.",
      );
      return;
    }
    onDraft(value.data);
    onClose();
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Meta ideal · {name}</DialogTitle>
          <DialogDescription>
            Rascunho não aplicado. A persistência com autoria e versão aguarda aprovação da
            migration. Nenhum resultado será reclassificado por este rascunho.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs">
              Biomarcador
              <Input value={name} readOnly />
            </label>
            <label className="text-xs">
              Modalidade
              <Input
                value={
                  (
                    {
                      PERCENTAGE: "Percentual",
                      ABSOLUTE: "Absoluto",
                      UNRESOLVED: "Não resolvido",
                      LITERAL: "Resultado",
                    } as Record<string, string>
                  )[modality] ?? modality
                }
                readOnly
              />
            </label>
            <label className="text-xs">
              Valor mínimo
              <Input
                aria-label="Mínimo ideal"
                inputMode="decimal"
                value={minimum}
                onChange={(e) => setMinimum(e.target.value)}
              />
            </label>
            <label className="text-xs">
              Valor máximo
              <Input
                aria-label="Máximo ideal"
                inputMode="decimal"
                value={maximum}
                onChange={(e) => setMaximum(e.target.value)}
              />
            </label>
            <label className="text-xs">
              Unidade
              <Input value={unit ?? "Não informada"} readOnly />
            </label>
            <label className="text-xs">
              Escopo da meta
              <select
                aria-label="Escopo da meta"
                className="h-10 w-full rounded-md border px-2"
                value={scope}
                onChange={(e) => setScope(e.target.value as IdealTargetDraft["scope"])}
              >
                <option value="PATIENT">Paciente</option>
                <option value="PROFESSIONAL">Profissional</option>
                <option value="ORGANIZATION">Organização</option>
              </select>
            </label>
          </div>
          <label className="block text-xs">
            Justificativa
            <Input
              aria-label="Justificativa da meta"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={1000}
            />
          </label>
          <label className="block text-xs">
            Data de vigência
            <Input
              aria-label="Vigência da meta"
              type="date"
              value={effectiveOn}
              onChange={(e) => setEffectiveOn(e.target.value)}
            />
          </label>
          {error && (
            <p role="alert" className="text-xs text-red-700">
              {error}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Origem: rascunho desta sessão do prontuário. Não compartilhado, sem versão clínica
            persistida. Não altera metas da organização ou de outros pacientes.
          </p>
          <div className="flex justify-end gap-2">
            {draft?.active && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  onDraft({ ...draft, active: false });
                  onClose();
                }}
              >
                Desativar rascunho
              </Button>
            )}
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button disabled={!unit} type="submit">
              Guardar rascunho
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
