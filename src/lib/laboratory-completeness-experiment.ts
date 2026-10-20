import type { LaboratoryRow } from "./laboratory-results";
import type { LaboratorySourcePage } from "./laboratory-evidence";
import {
  laboratoryAssociations,
  laboratoryLabeledField,
  normalizeLaboratoryText,
} from "./laboratory-source-association";

/** OFFLINE EXPERIMENT ONLY. Counts explicit recognizable rows, never claims full coverage.
 * This is deliberately not called by extraction, validation or publication routes. */
export function experimentLaboratoryInventory(
  pages: readonly LaboratorySourcePage[],
  rows: readonly LaboratoryRow[],
) {
  const inventory: { name: string; result: string; page: number; line: number }[] = [];
  for (const page of pages) {
    const lines = page.text.split(/\r?\n/u);
    for (const [i, line] of lines.entries()) {
      if (laboratoryLabeledField(line)) continue;
      const name = line
        .split(/[:|]/u)[0]
        ?.replace(/\.{2,}\s*$/u, "")
        .trim();
      if (!name || name.length > 160 || !/[:|]/u.test(line)) continue;
      const match = laboratoryAssociations(lines, name).find((a) => a.line === i + 1);
      if (match) inventory.push({ name, result: match.result, page: page.page, line: match.line });
    }
  }
  const remaining = [...rows];
  const key = (s: string) => normalizeLaboratoryText(s).toLocaleLowerCase("pt-BR");
  const possibleOmissions = inventory.filter((item) => {
    const index = remaining.findIndex(
      (r) =>
        key(r.name) === key(item.name) &&
        r.sourcePage === item.page &&
        key(r.result) === key(item.result),
    );
    if (index < 0) return true;
    remaining.splice(index, 1);
    return false;
  });
  return {
    scope: "recognizable_text_rows_only" as const,
    completenessProven: false as const,
    recognizableRows: inventory.length,
    possibleOmissions,
  };
}
