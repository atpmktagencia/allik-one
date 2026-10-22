import type { LaboratoryHistoryGroup } from "./laboratory-history";

export type LaboratoryModality = LaboratoryHistoryGroup & {
  modality: "PERCENTAGE" | "ABSOLUTE" | "UNRESOLVED" | "LITERAL";
  modalityLabel: string;
};
export type LaboratoryBiomarker = {
  id: string;
  name: string;
  modalities: LaboratoryModality[];
};
const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[.,;:]+/g, " ")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
const cells: Record<string, string> = {
  basofilos: "Basófilos",
  eosinofilos: "Eosinófilos",
  neutrofilos: "Neutrófilos",
  linfocitos: "Linfócitos",
  monocitos: "Monócitos",
};
function identity(name: string) {
  // Only display modality suffixes are removed. Clinical qualifiers remain in the base.
  const suffix =
    /\s*(?:\((%|percentual|absolutos?|absolutas?|contagem(?: absoluta)?|relativos?|relativas?|(?:com )?unidade n[aã]o informada|sem unidade|\/mm[³3]|\/[uµμ]l)\)|[-–:]\s*(%|percentual|absolutos?|absolutas?|contagem(?: absoluta)?|relativos?|relativas?|(?:com )?unidade n[aã]o informada|sem unidade)|\s+(%|percentual|absolutos?|absolutas?|contagem(?: absoluta)?|relativos?|relativas?|(?:com )?unidade n[aã]o informada|sem unidade))$/i;
  const matched = name.trim().match(suffix);
  const originalBase = name
    .trim()
    .replace(suffix, "")
    .replace(/^contagem (?:absoluta )?de /i, "")
    .trim();
  const base = fold(originalBase);
  const hint = fold(
    matched?.[1] ??
      matched?.[2] ??
      matched?.[3] ??
      (name.toLowerCase().startsWith("contagem absoluta de ") ? "absoluta" : ""),
  );
  const cell =
    /^(?:basofilos|eosinofilos|neutrofilos|linfocitos(?: atipicos)?|monocitos|plaquetas|leucocitos(?:\s*-?\s*global)?|eritrocitos|hemacias|reticulocitos)$/.test(
      base,
    );
  return { id: base, name: cells[base] ?? originalBase, cell, hint };
}
function modality(group: LaboratoryHistoryGroup, cell: boolean, hint: string) {
  const unit = (group.unit ?? "")
    .normalize("NFKC")
    .replace(/μ/g, "µ")
    .replace(/\s/g, "")
    .toLowerCase();
  const percentage = unit === "%";
  const absolute =
    /^(?:(?:celulas|células|cells))?\/(?:mm3|µl|ul)$/.test(unit) ||
    /^(?:10\^?3|103|mil)\/(?:µl|ul|mm3)$/.test(unit) ||
    /^(?:10\^?9|109)\/l$/.test(unit);
  const saysPercent = /%|percentual|relativ/.test(hint);
  const saysAbsolute = /absolut|contagem|\/(?:mm[³3]|[uµμ]l)/.test(hint);
  if (percentage && !saysAbsolute) return { kind: "PERCENTAGE" as const, label: "Percentual (%)" };
  if (absolute && !saysPercent)
    return { kind: "ABSOLUTE" as const, label: `Contagem absoluta (${group.unit})` };
  if (!cell && !hint && unit) return { kind: "LITERAL" as const, label: group.unit! };
  return {
    kind: "UNRESOLVED" as const,
    label: group.unit
      ? `Modalidade não resolvida (${group.unit})`
      : "Modalidade não resolvida · unidade não informada",
  };
}

/** Presentation only: never converts values or mutates confirmed results. Exact metadata
 * still partitions every modality; equivalent-looking units remain distinct series. */
export function groupLaboratoryBiomarkers(groups: LaboratoryHistoryGroup[]): LaboratoryBiomarker[] {
  const biomarkers = new Map<string, LaboratoryBiomarker>();
  for (const group of groups) {
    const base = identity(group.name);
    const mode = modality(group, base.cell, base.hint);
    let biomarker = biomarkers.get(base.id);
    if (!biomarker) {
      biomarker = { id: base.id, name: base.name, modalities: [] };
      biomarkers.set(base.id, biomarker);
    }
    const key = JSON.stringify([
      base.id,
      mode.kind,
      group.unit,
      group.method,
      group.material,
      group.laboratory,
      mode.kind === "UNRESOLVED" ? group.name : null,
    ]);
    const previous = biomarker.modalities.find((m) => m.id === key);
    if (previous) previous.entries.push(...group.entries);
    else
      biomarker.modalities.push({
        ...group,
        id: key,
        name: base.name,
        entries: [...group.entries],
        modality: mode.kind,
        modalityLabel: mode.label,
      });
  }
  const order = { PERCENTAGE: 0, ABSOLUTE: 1, LITERAL: 2, UNRESOLVED: 3 };
  for (const b of biomarkers.values())
    b.modalities.sort((a, b) => order[a.modality] - order[b.modality] || a.id.localeCompare(b.id));
  return [...biomarkers.values()];
}

export function laboratoryModalityLabel(mode: LaboratoryModality, siblings: LaboratoryModality[]) {
  return siblings.filter((s) => s.modalityLabel === mode.modalityLabel).length > 1
    ? `${mode.modalityLabel} · ${mode.method ?? "Método não informado"} · ${mode.material ?? "Material não informado"} · ${mode.laboratory ?? "Laboratório não informado"}`
    : mode.modalityLabel;
}
