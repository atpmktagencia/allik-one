import { laboratoryHistoryDate, type LaboratoryHistoryEntry } from "./laboratory-history";
import { laboratoryDisplayGroup } from "./laboratory-display-groups";
import { foldLaboratoryName, type LaboratoryClinicalGroup } from "./laboratory-catalog";

export function isLaboratoryObservation(entry: LaboratoryHistoryEntry) {
  return /^(?:obs|observacao|observacoes)(?:\.|:)?$/.test(foldLaboratoryName(entry.payload.name));
}
export type LaboratoryObservation = {
  entry: LaboratoryHistoryEntry;
  group: LaboratoryClinicalGroup | null;
};
/** Original narratives are not numeric results. Context must match document, page AND collection. */
export function projectLaboratoryObservations(rows: LaboratoryHistoryEntry[]) {
  const results = rows.filter((entry) => !isLaboratoryObservation(entry));
  const observations: LaboratoryObservation[] = rows
    .filter(isLaboratoryObservation)
    .map((entry) => {
      const peers =
        entry.payload.sourcePage == null
          ? []
          : results.filter(
              (other) =>
                other.documentId === entry.documentId &&
                other.payload.sourcePage === entry.payload.sourcePage &&
                laboratoryHistoryDate(other) === laboratoryHistoryDate(entry),
            );
      const groups = new Set(peers.map((other) => laboratoryDisplayGroup(other.payload.name)));
      const narrative = foldLaboratoryName(entry.payload.result);
      // Explicit hematological words support a group only when that page/collection contains hematology.
      const hematology =
        /\b(?:hemacias|plaquetas|linfocitos|leucocitose|leucocitos|neutrofilia|neutrofilos|anisocitose|hipocromia|microcitose)\b/.test(
          narrative,
        );
      const group =
        hematology && groups.has("Hematologia")
          ? "Hematologia"
          : groups.size === 1 && !groups.has("Outros")
            ? [...groups][0]!
            : null;
      return { entry, group };
    });
  return { results, observations };
}
