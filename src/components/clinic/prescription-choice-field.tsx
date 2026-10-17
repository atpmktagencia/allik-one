import { useId, useState } from "react";
import { Input } from "@/components/ui/input";

/** Explicit choice or free text, preserving custom values in previously saved protocols. */
export function PrescriptionChoiceField({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const selectId = useId();
  const [customValue, setCustomValue] = useState<string | null>(null);
  const custom = customValue === value || (value !== "" && !options.includes(value));
  return (
    <div className="min-w-0 space-y-1">
      <label htmlFor={selectId} className="block text-sm">
        {label}
      </label>
      <select
        id={selectId}
        className="mt-1 h-10 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-2 text-sm"
        disabled={disabled}
        value={custom ? "__custom__" : value}
        onChange={(event) => {
          if (event.target.value === "__custom__") setCustomValue(value);
          else {
            setCustomValue(null);
            onChange(event.target.value);
          }
        }}
      >
        <option value="">Selecionar…</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
        <option value="__custom__">Personalizar…</option>
      </select>
      {custom && (
        <label className="block text-xs text-muted-foreground">
          {label} personalizado
          <Input
            className="mt-1 min-w-0 bg-white"
            disabled={disabled}
            maxLength={100}
            value={value}
            onChange={(event) => {
              setCustomValue(event.target.value);
              onChange(event.target.value);
            }}
          />
        </label>
      )}
    </div>
  );
}
