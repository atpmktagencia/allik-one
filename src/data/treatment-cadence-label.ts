export function treatmentCadenceLabel(treatment: {
  frequencyEveryDays: string;
  frequencyEvery?: number | string | null;
  frequencyUnit?: string | null;
}) {
  const units: Record<string, string> = { DAY: "dia(s)", WEEK: "semana(s)", MONTH: "mês(es)" };
  return treatment.frequencyEvery && treatment.frequencyUnit && units[treatment.frequencyUnit]
    ? `a cada ${treatment.frequencyEvery} ${units[treatment.frequencyUnit]}`
    : `a cada ${treatment.frequencyEveryDays} dia(s)`;
}
