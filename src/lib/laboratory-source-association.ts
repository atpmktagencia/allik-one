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
  dateFormat: /^formato (?:das? |de )?datas?$/iu,
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

/** Identity, pagination and administrative dates are not analytes. These are exact
 * header labels, not a guess based merely on a line containing digits. */
const nonObservationLabel =
  /^(?:página|pagina|idade|id(?: do paciente)?|identificação(?: do paciente)?|identificacao(?: do paciente)?|paciente|prontuário|prontuario|registro|data (?:de )?nascimento|nascimento|número do pedido|numero do pedido|requisição|requisicao|protocolo|pedido|código do paciente|codigo do paciente|número da amostra|numero da amostra)$/iu;

/** Uses columns only when explicit separators and a unique current-result header survive. */
export function laboratoryAssociations(lines: string[], name: string): LaboratoryAssociation[] {
  if (!name.trim() || nonObservationLabel.test(normalizeLaboratoryText(name))) return [];
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

function observationLine(line: string, tableHeader?: string) {
  if (laboratoryLabeledField(line)) return false;
  const candidate = line
    .trim()
    .match(
      /^([\p{L}][^:|]{0,160}?)(?:\s*(?:\.{2,})?[:|]|\s+(?=(?:[<>≤≥]?\s*[+−-]?\d|não|reagente|negativo|positivo)))/iu,
    )?.[1]
    ?.trim();
  if (!candidate || nonObservationLabel.test(candidate)) return false;
  const context = line.includes("|") && tableHeader ? [tableHeader, line] : [line];
  return laboratoryAssociations(context, candidate).some((item) => item.line === context.length);
}

/** Metadata must have an anchored scope; inter-observation date/lab blocks
 * cannot be assumed to belong to either their preceding or following row. */
export function laboratoryMetadata(
  lines: string[],
  association: LaboratoryAssociation | undefined,
) {
  const result: Partial<Record<LaboratoryMetadataField, { value: string; line: number }[]>> & {
    scopeAmbiguous?: true;
    ambiguousFields?: LaboratoryMetadataField[];
  } = {};
  let start = 0;
  let historical = false;
  const anchor = association ? association.line - 1 : lines.length - 1;
  // Historical sections cannot supply the current observation's metadata.
  for (let i = 0; i <= anchor; i++) {
    if (
      /^(?:resultados? anteriores?|histórico(?: de resultados)?|valores? de referência|referências?)\s*:?$/iu.test(
        lines[i]!.trim(),
      )
    )
      historical = true;
    if (/^resultados? atuais?\s*:?$/iu.test(lines[i]!.trim())) {
      historical = false;
      start = i + 1;
    }
  }
  if (historical) return result;
  let tableHeader: string | undefined;
  const relativeFirstObservation = lines.slice(start).findIndex((line) => {
    if (/^\s*(?:exame|parâmetro|parametro)\s*\|/iu.test(line)) tableHeader = line;
    // A valid name/current-result/unit cell must actually parse on this line.
    // "Página 1 de 8" cannot pass as an observation just because it has a number.
    // Keep the recognition context bounded instead of rescanning a long header.
    return observationLine(line, tableHeader);
  });
  const firstObservation = relativeFirstObservation < 0 ? -1 : start + relativeFirstObservation;
  // An intervening labeled block may describe a new specimen or the preceding
  // analyte. Neither interpretation authorizes inheriting the earlier header.
  const interveningMetadata =
    association &&
    firstObservation >= 0 &&
    lines.slice(firstObservation + 1, anchor).some((line) => !!laboratoryLabeledField(line));
  if (interveningMetadata) {
    result.scopeAmbiguous = true;
    result.ambiguousFields = [
      ...new Set(
        lines.slice(start, anchor).flatMap((line) => {
          const labeled = laboratoryLabeledField(line);
          return labeled ? [labeled.key] : [];
        }),
      ),
    ];
  }
  const positions = new Set<number>();
  for (let i = start; i < (firstObservation < 0 ? start : firstObservation); i++) {
    if (interveningMetadata) break;
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
    const postPositions: number[] = [];
    let after = association.line;
    for (; after < lines.length; after++) {
      if (!lines[after]!.trim()) continue;
      if (!laboratoryLabeledField(lines[after]!)) break;
      postPositions.push(after);
      positions.add(after);
    }
    const hasDateOrLab = postPositions.some((i) => {
      const key = laboratoryLabeledField(lines[i]!)!.key;
      return key === "laboratory" || key === "dateFormat" || key.endsWith("On");
    });
    let laterTableHeader: string | undefined;
    const hasLaterObservation =
      hasDateOrLab &&
      lines.slice(after).some((line) => {
        if (/^\s*(?:exame|parâmetro|parametro)\s*\|/iu.test(line)) laterTableHeader = line;
        return observationLine(line, laterTableHeader);
      });
    if (hasLaterObservation) {
      result.scopeAmbiguous = true;
      result.ambiguousFields = [
        ...new Set([
          ...(result.ambiguousFields ?? []),
          ...[...positions].flatMap((i) => {
            const labeled = laboratoryLabeledField(lines[i]!);
            return labeled ? [labeled.key] : [];
          }),
        ]),
      ];
    }
  }
  for (const i of positions) {
    const labeled = laboratoryLabeledField(lines[i]!);
    if (labeled) (result[labeled.key] ??= []).push({ value: labeled.value, line: i + 1 });
  }
  return result;
}
