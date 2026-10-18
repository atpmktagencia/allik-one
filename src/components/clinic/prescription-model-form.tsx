import { useId, useState, type FormEvent } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
export type ModelFields = {
  title: string;
  category: string;
  description: string;
  visibility: "PRIVATE" | "ORGANIZATION" | "INSTITUTIONAL";
  unitIds: string[];
  confirmedNoPatientData: boolean;
};
export function PrescriptionModelForm({
  initial,
  units,
  canCreateShared,
  canCreateInstitutional,
  pending,
  onSave,
}: {
  initial: ModelFields;
  units: { id: string; name: string }[];
  canCreateShared: boolean;
  canCreateInstitutional: boolean;
  pending: boolean;
  onSave: (values: ModelFields) => void;
}) {
  const [values, setValues] = useState(initial);
  const visibilityId = useId();
  function submit(event: FormEvent) {
    event.preventDefault();
    if (values.confirmedNoPatientData && values.title.trim().length >= 2) onSave(values);
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <fieldset disabled={pending} className="space-y-3">
        <label className="block text-sm">
          Nome do modelo
          <Input
            required
            minLength={2}
            maxLength={160}
            value={values.title}
            onChange={(e) => setValues({ ...values, title: e.target.value })}
          />
        </label>
        <label className="block text-sm">
          Categoria do modelo
          <Input
            maxLength={100}
            value={values.category}
            onChange={(e) => setValues({ ...values, category: e.target.value })}
          />
        </label>
        <label className="block text-sm">
          Descrição do modelo
          <textarea
            className="mt-1 min-h-20 w-full rounded-lg border p-2"
            maxLength={2000}
            value={values.description}
            onChange={(e) => setValues({ ...values, description: e.target.value })}
          />
        </label>
        <div>
          <label htmlFor={visibilityId} className="text-sm">
            Visibilidade do modelo
          </label>
          <select
            id={visibilityId}
            className="mt-1 h-10 w-full rounded-lg border bg-white px-2"
            value={values.visibility}
            onChange={(e) =>
              setValues({ ...values, visibility: e.target.value as ModelFields["visibility"] })
            }
          >
            <option value="PRIVATE">Privado · somente eu e acessos concedidos</option>
            {canCreateShared && <option value="ORGANIZATION">Organização · compartilhado</option>}
            {canCreateInstitutional && (
              <option value="INSTITUTIONAL">Institucional · exige aprovação independente</option>
            )}
          </select>
        </div>
        <fieldset className="space-y-2 rounded-lg border p-2">
          <legend className="text-sm">Unidades do modelo</legend>
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={values.unitIds.length === 0}
              onChange={(e) =>
                setValues({
                  ...values,
                  unitIds: e.target.checked ? [] : units.slice(0, 1).map((unit) => unit.id),
                })
              }
            />
            Todas as unidades da organização
          </label>
          {units.map((unit) => (
            <label key={unit.id} className="flex gap-2 text-sm">
              <input
                type="checkbox"
                checked={values.unitIds.includes(unit.id)}
                onChange={(e) =>
                  setValues({
                    ...values,
                    unitIds: e.target.checked
                      ? [...values.unitIds, unit.id]
                      : values.unitIds.length > 1
                        ? values.unitIds.filter((id) => id !== unit.id)
                        : values.unitIds,
                  })
                }
              />
              {unit.name}
            </label>
          ))}
        </fieldset>
        <p className="text-xs text-muted-foreground">
          Para ampliar o acesso, marque explicitamente “Todas as unidades da organização”. Desmarcar
          a última unidade não amplia a abrangência.
        </p>
        <label className="flex gap-2 text-sm">
          <input
            type="checkbox"
            required
            checked={values.confirmedNoPatientData}
            onChange={(e) => setValues({ ...values, confirmedNoPatientData: e.target.checked })}
          />
          Confirmei que o modelo não contém dados pessoais de pacientes.
        </label>
        <p className="text-xs text-muted-foreground">
          Um modelo não é uma prescrição finalizada. Cada aplicação exige revisão clínica; modelos
          institucionais precisam de submissão e aprovação por outro responsável autorizado.
        </p>
        <Button
          type="submit"
          disabled={values.title.trim().length < 2 || !values.confirmedNoPatientData}
        >
          Salvar modelo
        </Button>
      </fieldset>
    </form>
  );
}
