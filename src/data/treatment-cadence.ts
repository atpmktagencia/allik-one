export type CadencePrescription = {
  frequencyEvery: number;
  frequencyUnit: string;
  durationAmount: number | null;
  durationUnit: string | null;
  continuousUse: boolean;
  plannedAdministrations: number | null;
};

function advance(start: Date, amount: number, unit: string) {
  const date = new Date(start);
  if (unit === "MONTH") {
    const day = start.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(start.getUTCMonth() + amount);
    const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(day, last));
  } else date.setUTCDate(date.getUTCDate() + amount * (unit === "WEEK" ? 7 : 1));
  return date;
}

export function buildTreatmentCadence(
  firstScheduledOn: string,
  item: CadencePrescription,
  quantity: number,
): string[] {
  const start = new Date(`${firstScheduledOn}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(firstScheduledOn) ||
    !Number.isFinite(start.getTime()) ||
    start.toISOString().slice(0, 10) !== firstScheduledOn
  )
    throw new Error("Informe uma data válida para a primeira aplicação.");
  if (item.frequencyUnit === "HOUR")
    throw new Error(
      "Cadência em horas exige agendamento com horário e ainda não pode ser ativada.",
    );
  if (
    !["DAY", "WEEK", "MONTH"].includes(item.frequencyUnit) ||
    !Number.isInteger(item.frequencyEvery) ||
    item.frequencyEvery < 1 ||
    item.frequencyEvery > 365
  )
    throw new Error("A prescrição precisa de frequência estruturada válida.");
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000)
    throw new Error("Quantidade de aplicações inválida.");
  if (item.plannedAdministrations != null && quantity > item.plannedAdministrations)
    throw new Error("O orçamento excede o número de aplicações prescrito.");
  let end: Date | null = null;
  if (!item.continuousUse) {
    if (
      !Number.isInteger(item.durationAmount) ||
      Number(item.durationAmount) < 1 ||
      !["DAY", "WEEK", "MONTH"].includes(item.durationUnit ?? "")
    )
      throw new Error("A prescrição precisa de duração estruturada válida.");
    end = advance(start, item.durationAmount!, item.durationUnit!);
  }
  const dates = Array.from({ length: quantity }, (_, index) =>
    advance(start, index * item.frequencyEvery, item.frequencyUnit),
  );
  if (end && dates.some((date) => date >= end!))
    throw new Error(
      "A quantidade comprada não cabe na duração prescrita. Revise a prescrição e o orçamento.",
    );
  if (dates.some((date) => date.getUTCFullYear() > 9999))
    throw new Error("A cadência excede o período permitido.");
  return dates.map((date) => date.toISOString().slice(0, 10));
}
