/** Conservative textual structures only. No inferred geometry, OCR or clinical conversions. */
export const normalizeLaboratoryText = (s: string) =>
  s.normalize("NFC").replace(/µ/g, "μ").replace(/\s+/gu, " ").trim();
const folded = (s: string) => normalizeLaboratoryText(s).toLocaleLowerCase("pt-BR");
// Approved typographic equivalences: micro sign/Greek mu and L/l for litre only.
export const laboratoryUnitKey = (s: string) =>
  normalizeLaboratoryText(s).replace(/\/([md]?)l\b/g, "/$1L");
const numeric = /^(?:[<>≤≥]\s*)?[+−-]?\d+(?:[.,]\d+)*(?:[eE][+−-]?\d+)?/u;
const qualitative =
  /^(?:não reagente|nao reagente|não detectado|nao detectado|não detectável|não reativo|reagente|negativo|positivo|detectado|ausente|presente|normal|indeterminado|inconclusivo)(?=$|[\s;|])/iu;
export type LaboratoryAssociation = {
  name: string;
  result: string;
  unit: string | null;
  reference: string | null;
  line: number;
  text: string;
};
export const laboratoryMetadataLabels = {
  collectedOn: /^(?:data (?:da |de )?coleta|coleta)$/iu,
  reportedOn:
    /^(?:data (?:do |de )?resultado|resultado em|liberação|data (?:da |de )?liberação)$/iu,
  issuedOn: /^(?:emissão|data (?:da |de )?emissão|emitido em)$/iu,
  laboratory: /^(?:laboratório|laboratorio)$/iu,
  method: /^(?:método|metodo|método analítico)$/iu,
  material: /^(?:material|amostra)$/iu,
} as const;
export type LaboratoryMetadataField = keyof typeof laboratoryMetadataLabels;
export function laboratoryLabeledField(line: string) {
  const match = line.match(/^\s*([^:;|]{1,70}?)\s*(?:\.{2,})?\s*:\s*(.+?)\s*$/u);
  if (!match) return null;
  const label = match[1]!.replace(/\.+$/u, "").trim();
  const key = (Object.keys(laboratoryMetadataLabels) as LaboratoryMetadataField[]).find((k) =>
    laboratoryMetadataLabels[k].test(label),
  );
  return key ? { key, value: match[2]! } : null;
}
export function laboratoryResultCell(cell: string) {
  const text = normalizeLaboratoryText(cell);
  const match = text.match(numeric) ?? text.match(qualitative);
  if (!match) return null;
  const result = match[0].replace(/([<>≤≥])\s+/gu, "$1");
  const rest = text.slice(match[0].length).trim();
  if (rest && !/^(?:[\p{L}μ%][\p{L}\p{N}μ/%^().·*+−-]*|10\^\d+\/[\p{L}\p{N}]+)$/u.test(rest))
    return null;
  return { result, unit: rest || null };
}
const referenceLabel = /(?:^|[;\s])(?:referência|referencia|ref\.?)(?:\s*(?:\.{2,})?\s*:\s*|\s+)/iu;
const stopLabel =
  /(?:^|[;\s])(?:resultado anterior|anterior|histórico|historico|coleta|data|método|metodo|material|laboratório|laboratorio)\s*:?/iu;

/** Uses columns only when explicit separators and a unique current-result header survive. */
export function laboratoryAssociations(lines: string[], name: string): LaboratoryAssociation[] {
  if (!name.trim()) return [];
  const matches: LaboratoryAssociation[] = [],
    target = folded(name);
  let historicalSection = false;
  for (let i = 0; i < lines.length; i++) {
    const text = normalizeLaboratoryText(lines[i]!);
    if (
      /^(?:resultados? anteriores?|histórico(?: de resultados)?|valores? de referência|referências?)\s*:?$/iu.test(
        text,
      )
    )
      historicalSection = true;
    if (/^resultados? atuais?\s*:?$/iu.test(text)) historicalSection = false;
    if (historicalSection) continue;
    const cells = text.split("|").map((s) => s.trim());
    if (cells.length > 1) {
      if (folded(cells[0]!.replace(/\.{2,}\s*:?$/u, "")) !== target) continue;
      const header = lines
        .slice(0, i)
        .reverse()
        .find((s) => /^\s*(?:exame|parâmetro|parametro)\s*\|/iu.test(s));
      if (!header) continue;
      const labels = header.split("|").map(folded);
      const current = labels.flatMap((s, index) =>
        /^(?:resultado(?: atual)?|atual)$/.test(s) ? [index] : [],
      );
      if (current.length !== 1 || cells.length !== labels.length) continue;
      const parsed = laboratoryResultCell(cells[current[0]!]!);
      if (!parsed) continue;
      const unitColumn = labels.findIndex((s) => s === "unidade");
      if (
        unitColumn >= 0 &&
        parsed.unit &&
        laboratoryUnitKey(cells[unitColumn]!) !== laboratoryUnitKey(parsed.unit)
      )
        continue;
      const referenceColumn = labels.findIndex((s) =>
        /^(?:referência|referencia)(?: laboratorial)?$/.test(s),
      );
      matches.push({
        name,
        ...parsed,
        unit: unitColumn >= 0 ? cells[unitColumn]! || null : parsed.unit,
        reference: referenceColumn >= 0 ? cells[referenceColumn]! || null : null,
        line: i + 1,
        text,
      });
      continue;
    }
    if (!folded(text).startsWith(target)) continue;
    const remainder = text.slice(normalizeLaboratoryText(name).length);
    if (!/^(?:\s|:|：|\.{2,}(?=\s|:|$)|…+(?=\s|:|$))/u.test(remainder)) continue;
    const tail = remainder.replace(/^\s*(?:(?:\.{2,}|…+)\s*)?[:：]?\s*/u, "");
    const ref = tail.match(referenceLabel),
      stop = tail.match(stopLabel);
    const end = Math.min(ref?.index ?? tail.length, stop?.index ?? tail.length);
    const parsed = laboratoryResultCell(tail.slice(0, end).replace(/[;\s]+$/u, ""));
    if (!parsed) continue;
    let reference: string | null = null;
    if (ref) {
      const content = tail.slice(ref.index! + ref[0].length),
        after = content.match(stopLabel);
      reference = content.slice(0, after?.index ?? content.length).replace(/[;\s]+$/u, "") || null;
    }
    matches.push({ name, ...parsed, reference, line: i + 1, text });
  }
  return matches;
}

/** Metadata must be a page header or immediately follow the anchored row. */
export function laboratoryMetadata(
  lines: string[],
  association: LaboratoryAssociation | undefined,
) {
  const result: Partial<Record<LaboratoryMetadataField, { value: string; line: number }[]>> = {};
  const firstObservation = lines.findIndex(
    (line) =>
      !laboratoryLabeledField(line) &&
      /^[\p{L}][^:|]{0,160}?(?::|\||\s)\s*(?:[<>≤≥]?\s*[+−-]?\d|não|reagente|negativo|positivo)/iu.test(
        line.trim(),
      ),
  );
  const positions = new Set<number>();
  for (let i = 0; i < (firstObservation < 0 ? 0 : firstObservation); i++) {
    const labeled = laboratoryLabeledField(lines[i]!);
    // An analyte-specific method/material before the first observation is not
    // evidence that it also applies to subsequent observations on the page.
    if (
      labeled &&
      ["method", "material"].includes(labeled.key) &&
      association?.line !== firstObservation + 1
    )
      continue;
    positions.add(i);
  }
  if (association) {
    for (let i = association.line; i < lines.length; i++) {
      if (!lines[i]!.trim()) continue;
      if (!laboratoryLabeledField(lines[i]!)) break;
      positions.add(i);
    }
  }
  for (const i of positions) {
    const labeled = laboratoryLabeledField(lines[i]!);
    if (labeled) (result[labeled.key] ??= []).push({ value: labeled.value, line: i + 1 });
  }
  return result;
}
