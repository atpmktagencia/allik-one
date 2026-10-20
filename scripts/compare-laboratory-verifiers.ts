/** Independent deterministic controls only. No provider, database or application API calls. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { checkLaboratoryEvidence as current } from "../src/lib/laboratory-evidence";
import { emptyLaboratoryRow, type LaboratoryRow } from "../src/lib/laboratory-results";

const root = new URL("../", import.meta.url);
const previousDirectory = new URL("../work/benchmark-d/v2/", import.meta.url);
await mkdir(previousDirectory, { recursive: true });
const oldCommit = "4e9f9c034e9465e87cd0d96394ae3814ca2511f9";
const oldSources: { path: string; sha256: string }[] = [];
for (const name of ["laboratory-evidence.ts", "laboratory-source-association.ts"]) {
  const path = "src/lib/" + name;
  const bytes = execFileSync("git", ["show", oldCommit + ":" + path], {
    cwd: fileURLToPath(root),
  });
  await writeFile(new URL(name, previousDirectory), bytes);
  oldSources.push({ path, sha256: createHash("sha256").update(bytes).digest("hex") });
}
// Runtime dependencies of the old verifier are only source-association; type imports erase.
const previous: typeof current = (
  await import(new URL("laboratory-evidence.ts", previousDirectory).href)
).checkLaboratoryEvidence;
const row = (patch: Partial<LaboratoryRow>) => ({
  ...emptyLaboratoryRow(),
  name: "Glicose",
  result: "90",
  unit: "mg/dL",
  sourcePage: 1,
  evidence: null,
  issuedOn: null,
  ...patch,
});
const cases = [
  {
    id: "ambiguous-numeric-date-assumed-dmy",
    expectedLegitimateTrust: false,
    rationale:
      "02/01 is ambiguous without a declared date order; a filled date cannot be independently trusted.",
    text: "Coleta: 02/01/2026\nGlicose: 90 mg/dL",
    row: row({ collectedOn: "2026-01-02" }),
  },
  {
    id: "wrong-earlier-laboratory-date-inherited",
    expectedLegitimateTrust: false,
    rationale:
      "A new laboratory/date block intervenes; Lab A's metadata cannot be assigned to Ureia in Lab B's block.",
    text: "Laboratório: Laboratório A\nColeta: 2026-01-15\nGlicose: 90 mg/dL\nLaboratório: Laboratório B\nColeta: 2026-02-20\nUreia: 30 mg/dL",
    row: row({
      name: "Ureia",
      result: "30",
      laboratory: "Laboratório A",
      collectedOn: "2026-01-15",
    }),
  },
  {
    id: "age-header-hides-omitted-source-date",
    expectedLegitimateTrust: false,
    rationale:
      "The source prints an unambiguous collection date; treating an age as the first analyte must not hide its omission.",
    text: "Idade: 53 anos\nColeta: 2026-01-15\nGlicose: 90 mg/dL",
    row: row({}),
  },
  {
    id: "pagination-emitted-as-analyte",
    expectedLegitimateTrust: false,
    rationale:
      "Page numbering is not a laboratory parameter, even if the number and a nearby date match literally.",
    text: "Página: 1\nColeta: 2026-01-15\nGlicose: 90 mg/dL",
    row: row({ name: "Página", result: "1", unit: null, collectedOn: "2026-01-15" }),
  },
  {
    id: "next-laboratory-header-applied-backward",
    expectedLegitimateTrust: false,
    rationale:
      "Metadata between observations may introduce the following laboratory; it is not an unequivocal postfix for Glicose.",
    text: "Glicose: 90 mg/dL\nLaboratório: Laboratório B\nColeta: 2026-02-20\nUreia: 30 mg/dL",
    row: row({ laboratory: "Laboratório B", collectedOn: "2026-02-20" }),
  },
  {
    id: "intervening-date-applied-backward",
    expectedLegitimateTrust: false,
    rationale:
      "A collection date between two observations has unproven scope; the verifier must not choose the preceding one silently.",
    text: "Glicose: 90 mg/dL\nColeta: 2026-02-20\nUreia: 30 mg/dL",
    row: row({ collectedOn: "2026-02-20" }),
  },
  {
    id: "positive-unambiguous-iso-header",
    expectedLegitimateTrust: true,
    rationale: "A unique ISO date in the common header has a clear role and no intervening block.",
    text: "Coleta: 2026-01-15\nGlicose: 90 mg/dL",
    row: row({ collectedOn: "2026-01-15" }),
  },
  {
    id: "positive-explicit-dmy-header",
    expectedLegitimateTrust: true,
    rationale:
      "The common source header explicitly declares DD/MM/AAAA, so 02/01 is not an unresolved locale assumption.",
    text: "Formato das datas: DD/MM/AAAA\nColeta: 02/01/2026\nGlicose: 90 mg/dL",
    row: row({ collectedOn: "2026-01-02" }),
  },
];
const output = cases.map((item) => {
  const pages = [{ page: 1, text: item.text }];
  const before = previous(item.row, pages);
  const after = current(item.row, pages);
  return {
    ...item,
    before,
    after,
    beforeEligible: before.status === "literal_match" && before.basis === "source_text",
    afterEligible: after.status === "literal_match" && after.basis === "source_text",
  };
});
const score = (when: "beforeEligible" | "afterEligible") => ({
  eligible: output.filter((item) => item[when]).length,
  unsafeEligible: output.filter((item) => item[when] && !item.expectedLegitimateTrust).length,
  falseAlerts: output.filter((item) => !item[when] && item.expectedLegitimateTrust).length,
});
const newSources = await Promise.all(
  ["laboratory-evidence.ts", "laboratory-source-association.ts", "laboratory-date-evidence.ts"].map(
    async (name) => {
      const path = "src/lib/" + name;
      return {
        path,
        sha256: createHash("sha256")
          .update(await readFile(new URL(path, root)))
          .digest("hex"),
      };
    },
  ),
);
const report = {
  outputOrigin: "synthetic-independent-deterministic-controls-not-live-inference",
  purpose:
    "Same observations and source text, independently specified trust labels, compared across old and new verifiers. Not clinical accuracy or real-model improvement.",
  oldCommit,
  oldSources,
  currentSources: newSources,
  cases: output,
  totals: {
    controls: output.length,
    expectedLegitimatelyEligible: output.filter((item) => item.expectedLegitimateTrust).length,
    before: score("beforeEligible"),
    after: score("afterEligible"),
  },
};
console.log(JSON.stringify(report, null, 2));
