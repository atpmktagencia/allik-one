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
  const text = fold(name);
  const match = text.match(
    /^(?:contagem (?:absoluta )?de )?(basofilos|eosinofilos|neutrofilos|linfocitos|monocitos)(?:\s*(?:\(([^)]+)\)|[-–:]\s*(.+)|(%|percentual|absolutos?|contagem(?: absoluta)?|relativos?|(?:com )?unidade nao informada|sem unidade)))?$/,
  );
  if (!match) return { id: text, name: name.trim(), cell: false, hint: "" };
  const suffix = (match[2] ?? match[3] ?? match[4] ?? "").trim();
  // Only explicitly known display suffixes. Never strip clinically meaningful qualifiers.
  if (
    suffix &&
    !/^(?:%|percentual|relativos?|absolutos?|contagem(?: absoluta)?|(?:com )?unidade nao informada|sem unidade|\/mm[³3]|\/u[lL]|celulas\/mm[³3])$/.test(
      suffix,
    )
  )
    return { id: text, name: name.trim(), cell: false, hint: "" };
  return {
    id: match[1]!,
    name: cells[match[1]!]!,
    cell: true,
    hint: text.startsWith("contagem absoluta de ") ? "absoluta" : suffix,
  };
}
function modality(group: LaboratoryHistoryGroup, cell: boolean, hint: string) {
  if (!cell) return { kind: "LITERAL" as const, label: group.unit ?? "Unidade não informada" };
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
  const saysAbsolute = /absolut|contagem/.test(hint);
  if (percentage && !saysAbsolute) return { kind: "PERCENTAGE" as const, label: "Percentual (%)" };
  if (absolute && !saysPercent)
    return { kind: "ABSOLUTE" as const, label: `Contagem absoluta (${group.unit})` };
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
