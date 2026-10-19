/** Arithmetic check only: one administration per interval, first at the start.
 * Never converts calendar months to a fixed number of days or recommends a dose.
 */
export function administrationCountCheck(item: {
  frequencyEvery: number | null;
  frequencyUnit: string;
  durationAmount: number | null;
  durationUnit: string | null;
  continuousUse: boolean;
  plannedAdministrations: number | null;
}) {
  const hours: Record<string, number> = { HOUR: 1, DAY: 24, WEEK: 168 };
  let expected: number | null = null;
  if (!item.continuousUse && item.frequencyEvery && item.durationAmount) {
    if (item.frequencyUnit === "MONTH" && item.durationUnit === "MONTH")
      expected = Math.ceil(item.durationAmount / item.frequencyEvery);
    else if (hours[item.frequencyUnit] && item.durationUnit && hours[item.durationUnit])
      expected = Math.ceil(
        (item.durationAmount * hours[item.durationUnit]!) /
          (item.frequencyEvery * hours[item.frequencyUnit]!),
      );
  }
  return {
    expected,
    needsReason:
      item.plannedAdministrations !== null &&
      (expected === null || item.plannedAdministrations !== expected),
  };
}

export type TherapeuticPrescriptionSource = {
  prescriptionId: string;
  version: number;
  updatedAt: string;
};
