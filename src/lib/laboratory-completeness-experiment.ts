import type { LaboratoryRow } from "./laboratory-results";
import type { LaboratorySourcePage } from "./laboratory-evidence";
import {
  laboratoryAssociations,
  laboratoryLabeledField,
  laboratoryUnitKey,
  normalizeLaboratoryText,
} from "./laboratory-source-association";

type InventoryRow = { name: string; result: string; page: number; line: number };
type SectionKind = "unspecified" | "current" | "historical" | "reference";
type UnrecognizedLine = { line: number; reason: "unsupported_or_non_observation_text" };
const key = (s: string) => normalizeLaboratoryText(s).toLocaleLowerCase("pt-BR");
const valueKey = (s: string) => key(s).replace(/([<>≤≥])\s+/gu, "$1");
function sectionKind(line: string): SectionKind | null {
  if (/^resultados? atuais?\s*:?$/iu.test(line)) return "current";
  if (/^(?:resultados? anteriores?|histórico(?: de resultados)?)\s*:?$/iu.test(line))
    return "historical";
  if (/^(?:valores? de referência|referências?)\s*:?$/iu.test(line)) return "reference";
  return null;
}

/** OFFLINE EXPERIMENT ONLY. No inference, geometry, OCR, publication or claim of completeness.
 * Coverage describes only supplied native-text lines. This recognizer is shared with the
 * verifier, so their blind spots are correlated; an empty inventory is not reassuring. */
export function experimentLaboratoryInventory(
  pages: readonly LaboratorySourcePage[],
  rows: readonly LaboratoryRow[],
  options: { expectedPageCount?: number } = {},
) {
  const inventory: InventoryRow[] = [];
  const sourceUnits = new Map<InventoryRow, string | null>();
  const pageCoverage = pages.map((page) => {
    const lines = page.text.split(/\r?\n/u);
    const unknownLines: UnrecognizedLine[] = [];
    const sections: {
      kind: SectionKind;
      startLine: number;
      endLine: number;
      recognizedRows: number;
      unrecognizedLines: number[];
    }[] = [];
    let section = {
      kind: "unspecified" as SectionKind,
      startLine: 1,
      endLine: lines.length,
      recognizedRows: 0,
      unrecognizedLines: [] as number[],
    };
    let recognizedRows = 0;
    for (const [i, line] of lines.entries()) {
      const text = normalizeLaboratoryText(line);
      if (!text) continue;
      const heading = sectionKind(text);
      if (heading) {
        if (i > section.startLine - 1) {
          section.endLine = i;
          sections.push(section);
        }
        section = {
          kind: heading,
          startLine: i + 1,
          endLine: lines.length,
          recognizedRows: 0,
          unrecognizedLines: [],
        };
        continue;
      }
      if (laboratoryLabeledField(line)) continue;
      if (
        /^(?:paciente|identificação|identificacao|id|idade|página|pagina|protocolo|pedido|nascimento|data(?: histórica| historica)?|data de nascimento|sexo|formato das datas)\s*:/iu.test(
          text,
        )
      )
        continue;
      if (/^\s*(?:exame|parâmetro|parametro)\s*\|/iu.test(line)) continue;
      const name = line
        .split(/[:|]/u)[0]
        ?.replace(/\.{2,}\s*$/u, "")
        .trim();
      const association =
        name && name.length <= 160 && /[:|]/u.test(line)
          ? laboratoryAssociations(lines, name).find((a) => a.line === i + 1)
          : undefined;
      if (association) {
        const item = { name: name!, result: association.result, page: page.page, line: i + 1 };
        inventory.push(item);
        sourceUnits.set(item, association.unit);
        recognizedRows++;
        section.recognizedRows++;
      } else if (section.kind !== "historical" && section.kind !== "reference") {
        unknownLines.push({ line: i + 1, reason: "unsupported_or_non_observation_text" });
        section.unrecognizedLines.push(i + 1);
      }
    }
    sections.push(section);
    const hasText = page.text.trim().length > 0;
    return {
      page: page.page,
      status: !hasText
        ? ("no_independent_text" as const)
        : unknownLines.length
          ? ("unrecognized_text_present" as const)
          : recognizedRows
            ? ("recognized_text_only" as const)
            : ("no_current_observations_recognized" as const),
      nonEmptyLines: lines.filter((line) => line.trim()).length,
      recognizedRows,
      unknownLines,
      sections,
    };
  });

  const remainingPredictions = new Set(rows.map((_, i) => i));
  const unresolvedSources = new Set(inventory);
  const sameName = (source: InventoryRow, index: number) =>
    key(source.name) === key(rows[index]!.name);
  const sameValue = (source: InventoryRow, index: number) =>
    valueKey(source.result) === valueKey(rows[index]!.result);
  const candidates = (source: InventoryRow) =>
    [...remainingPredictions].filter((i) => sameName(source, i));
  const valueMismatches: { source: InventoryRow; predictionIndex: number; actual: string }[] = [];
  const unitMismatches: {
    source: InventoryRow;
    predictionIndex: number;
    expected: string | null;
    actual: string | null;
  }[] = [];
  const provenanceMissing: { source: InventoryRow; predictionIndex: number }[] = [];
  const pageMismatches: { source: InventoryRow; predictionIndex: number; actualPage: number }[] =
    [];
  const ambiguousProvenance: { sources: InventoryRow[]; predictionIndexes: number[] }[] = [];
  function consume(source: InventoryRow, index: number) {
    unresolvedSources.delete(source);
    remainingPredictions.delete(index);
    if (!sameValue(source, index))
      valueMismatches.push({ source, predictionIndex: index, actual: rows[index]!.result });
    const expectedUnit = sourceUnits.get(source) ?? null;
    const actualUnit = rows[index]!.unit;
    if (
      (expectedUnit ? laboratoryUnitKey(expectedUnit) : null) !==
      (actualUnit ? laboratoryUnitKey(actualUnit) : null)
    )
      unitMismatches.push({
        source,
        predictionIndex: index,
        expected: expectedUnit,
        actual: actualUnit,
      });
  }
  // Match exact occurrences first, across all pages, before considering an incorrect
  // value or provenance. One prediction can never satisfy two source occurrences.
  for (const source of inventory) {
    const index = candidates(source).find(
      (i) => rows[i]!.sourcePage === source.page && sameValue(source, i),
    );
    if (index !== undefined) consume(source, index);
  }
  for (const source of [...unresolvedSources]) {
    const index = candidates(source).find((i) => rows[i]!.sourcePage === source.page);
    if (index !== undefined) consume(source, index);
  }
  const handledNames = new Set<string>();
  for (const source of [...unresolvedSources]) {
    const name = key(source.name);
    if (handledNames.has(name)) continue;
    handledNames.add(name);
    const sources = [...unresolvedSources].filter((s) => key(s.name) === name);
    const indexes = candidates(source);
    if (sources.length === 1 && indexes.length === 1) {
      const index = indexes[0]!;
      if (rows[index]!.sourcePage === null)
        provenanceMissing.push({ source, predictionIndex: index });
      else
        pageMismatches.push({
          source,
          predictionIndex: index,
          actualPage: rows[index]!.sourcePage!,
        });
      consume(source, index);
    } else if (indexes.length) {
      ambiguousProvenance.push({ sources, predictionIndexes: indexes });
      // Repeated parameters without reliable occurrence provenance cannot be
      // assigned to an arbitrary page or reported as definite omissions.
      for (const item of sources) unresolvedSources.delete(item);
      for (const index of indexes) remainingPredictions.delete(index);
    }
  }
  const providedPages = [...new Set(pages.map((page) => page.page))].sort((a, b) => a - b);
  const expectedPageCount = options.expectedPageCount ?? null;
  const missingPages =
    expectedPageCount !== null &&
    Number.isSafeInteger(expectedPageCount) &&
    expectedPageCount >= 0 &&
    expectedPageCount <= 1000
      ? Array.from({ length: expectedPageCount }, (_, i) => i + 1).filter(
          (page) => !providedPages.includes(page),
        )
      : null;
  return {
    version: 2,
    scope: "recognizable_text_rows_only" as const,
    completenessProven: false as const,
    recognizableRows: inventory.length,
    possibleOmissions: [...unresolvedSources],
    coverage: {
      basis: "supplied_native_text_lines" as const,
      coordinatesAvailable: false as const,
      independentTextAvailable: pages.some((page) => page.text.trim().length > 0),
      expectedPageCount,
      providedPages,
      missingPages,
      duplicatePageNumbers: providedPages.filter(
        (number) => pages.filter((p) => p.page === number).length > 1,
      ),
      pages: pageCoverage,
    },
    diagnostics: {
      valueMismatches,
      unitMismatches,
      provenanceMissing,
      pageMismatches,
      ambiguousProvenance,
      unmatchedPredictions: [...remainingPredictions].map((index) => ({
        predictionIndex: index,
        name: rows[index]!.name,
        result: rows[index]!.result,
        sourcePage: rows[index]!.sourcePage,
        reason: "no_remaining_recognizable_source" as const,
      })),
    },
  };
}
