import { describe, expect, it } from "vitest";
import { checkLaboratoryEvidence } from "@/lib/laboratory-evidence";
import { interpretLaboratoryDate, recoverLaboratoryDates } from "@/lib/laboratory-date-evidence";
import { emptyLaboratoryRow, type LaboratoryRow } from "@/lib/laboratory-results";

const row = (patch: Partial<LaboratoryRow> = {}): LaboratoryRow => ({
  ...emptyLaboratoryRow(),
  name: "Ferritina",
  result: "45.5",
  unit: "ng/mL",
  sourcePage: 1,
  issuedOn: null,
  evidence: "Ferritina: 45.5 ng/mL",
  ...patch,
});
describe("independent date interpretation", () => {
  it.each([
    ["2026-01-02", "2026-01-02"],
    ["22/01/2026", "2026-01-22"],
    ["01/22/2026", "2026-01-22"],
    ["01/01/2026", "2026-01-01"],
    ["2024-02-29 às 23:59:59", "2024-02-29"],
    ["02/01/2026 (DD/MM/AAAA)", "2026-01-02"],
  ])("transcribes %s only when its interpretation is unique", (printed, expected) => {
    expect(interpretLaboratoryDate(printed)).toEqual({ status: "valid", value: expected });
  });
  it.each([
    "30/02/2026",
    "2026-02-29",
    "0000-01-01",
    "02/03/04",
    "2026-01-02 25:00",
    "2026-01-02 23:60",
    "2026-01-02 23:50:60",
  ])("rejects invalid source date %s", (printed) => {
    expect(interpretLaboratoryDate(printed).status).toBe("invalid");
  });
  it("requires format evidence for ambiguous numeric dates and rejects conflicting declarations", () => {
    expect(interpretLaboratoryDate("02/01/2026")).toEqual({ status: "ambiguous", value: null });
    expect(interpretLaboratoryDate("02/01/2026", ["DD/MM/AAAA"])).toEqual({
      status: "valid",
      value: "2026-01-02",
    });
    expect(interpretLaboratoryDate("02/01/2026", ["MM/DD/YYYY"])).toEqual({
      status: "valid",
      value: "2026-02-01",
    });
    expect(interpretLaboratoryDate("02/01/2026", ["DD/MM/AAAA", "MM/DD/YYYY"]).status).toBe(
      "ambiguous",
    );
    expect(interpretLaboratoryDate("22/01/2026", ["MM/DD/YYYY"]).status).toBe("invalid");
  });
});
describe("conservative independent recovery", () => {
  it.each([
    "número do pedido",
    "numero do pedido",
    "requisição",
    "requisicao",
    "protocolo",
    "pedido",
    "código do paciente",
    "codigo do paciente",
    "número da amostra",
    "numero da amostra",
  ])(
    "rejects administrative identifier %s as a result while preserving a real source date",
    (name) => {
      const printed = [
        { page: 1, text: `${name}: 123456\nColeta: 2026-01-15\nFerritina: 45.5 ng/mL` },
      ];
      const identifier = row({ name, result: "123456", unit: null, evidence: `${name}: 123456` });
      expect(checkLaboratoryEvidence(identifier, printed).issues).toContain("ASSOCIATION_UNPROVEN");
      expect(checkLaboratoryEvidence(identifier, printed).status).toBe("attention");
      expect(recoverLaboratoryDates([identifier], printed).recoveries).toEqual([]);
      expect(recoverLaboratoryDates([row()], printed).rows[0]!.collectedOn).toBe("2026-01-15");
    },
  );
  const source = [
    {
      page: 1,
      text: "Coleta: 2026-01-02\nData do resultado: 2026-01-04\nEmissão: 2026-01-05\nFerritina: 45.5 ng/mL",
    },
  ];
  it("recovers separate missing roles with technical provenance and preserves uncertainty and the input", () => {
    const original = row({ uncertainty: "Rever dados do documento." });
    const copy = structuredClone(original);
    const recovered = recoverLaboratoryDates([original], source);
    expect(original).toEqual(copy);
    expect(recovered.rows[0]).toMatchObject({
      collectedOn: "2026-01-02",
      reportedOn: "2026-01-04",
      issuedOn: "2026-01-05",
      verified: false,
      uncertainty: original.uncertainty,
    });
    expect(recovered.recoveries).toEqual([
      { row: 0, field: "collectedOn", page: 1, line: 1 },
      { row: 0, field: "reportedOn", page: 1, line: 2 },
      { row: 0, field: "issuedOn", page: 1, line: 3 },
    ]);
    expect(JSON.stringify(recovered.recoveries)).not.toMatch(/2026|Ferritina|45.5/);
    expect(checkLaboratoryEvidence(recovered.rows[0]!, source).fields.collectedOn.status).toBe(
      "supported",
    );
  });
  it("uses explicit scoped format without relying on language or another date", () => {
    const printed = [
      {
        page: 1,
        text: "Formato das datas: DD/MM/AAAA\nColeta: 02/01/2026\nData do resultado: 04/01/2026\nEmissão: 05/01/2026\nFerritina: 45.5 ng/mL",
      },
    ];
    expect(recoverLaboratoryDates([row()], printed).rows[0]).toMatchObject({
      collectedOn: "2026-01-02",
      reportedOn: "2026-01-04",
      issuedOn: "2026-01-05",
    });
    const ambiguous = [
      { page: 1, text: printed[0]!.text.replace("Formato das datas: DD/MM/AAAA\n", "") },
    ];
    expect(recoverLaboratoryDates([row()], ambiguous).recoveries).toEqual([]);
    const checked = checkLaboratoryEvidence(row({ collectedOn: "2026-01-02" }), ambiguous);
    expect(checked.issues).toContain("DATE_AMBIGUOUS");
    expect(checked.fields.collectedOn.status).toBe("insufficient");
  });
  it("does not invent missing roles, use source snippets or treat a scan as independent evidence", () => {
    const emitted = row({ evidence: source[0]!.text });
    expect(recoverLaboratoryDates([emitted]).recoveries).toEqual([]);
    expect(
      recoverLaboratoryDates(
        [row()],
        [{ page: 1, text: "Emissão: 2026-01-05\nFerritina: 45.5 ng/mL" }],
      ).rows[0],
    ).toMatchObject({ collectedOn: null, reportedOn: null, issuedOn: "2026-01-05" });
    expect(recoverLaboratoryDates([row({ sourcePage: 2 })], source).recoveries).toEqual([]);
  });
  it("never overwrites model fields or recovers dates through conflicts, mismatched results or units", () => {
    for (const changed of [row({ result: "99" }), row({ unit: "mg/mL" })])
      expect(recoverLaboratoryDates([changed], source).recoveries).toEqual([]);
    const conflict = [{ page: 1, text: "Coleta: 2026-01-03\n" + source[0]!.text }];
    expect(recoverLaboratoryDates([row()], conflict).rows[0]!.collectedOn).toBeNull();
    const existing = row({ collectedOn: "2026-01-10" });
    expect(recoverLaboratoryDates([existing], source)).toEqual({
      rows: [existing],
      recoveries: [],
    });
    expect(
      recoverLaboratoryDates(
        [row()],
        [{ page: 1, text: source[0]!.text.replace("2026-01-02", "2026-01-06") }],
      ).recoveries,
    ).toEqual([]);
  });
  it("does not borrow historical section dates or dates from another observation", () => {
    const historical = [
      {
        page: 1,
        text: "Resultados anteriores\nColeta: 2025-01-02\nFerritina: 40 ng/mL\nResultados atuais\nFerritina: 45.5 ng/mL",
      },
    ];
    expect(recoverLaboratoryDates([row()], historical).recoveries).toEqual([]);
    const neighbor = [
      { page: 1, text: "Glicose: 90 mg/dL\nColeta: 2026-01-02\nFerritina: 45.5 ng/mL" },
    ];
    expect(recoverLaboratoryDates([row()], neighbor).recoveries).toEqual([]);
    expect(
      recoverLaboratoryDates(
        [row()],
        [{ page: 1, text: source[0]!.text + "\nFerritina: 45.5 ng/mL" }],
      ).recoveries,
    ).toEqual([]);
  });
  it("does not mistake numeric page/identity headers or a birth date for the first clinical observation", () => {
    const headers = [
      "DOCUMENTO SINTÉTICO — SOMENTE TESTE",
      "Página 1 de 8 — resultados atuais de uma coleta distinta.",
      "ID do paciente: 123456",
      "Idade: 53 anos",
      "Data de nascimento: 2020-01-01",
      "Coleta: 2026-01-02",
      "Data do resultado: 2026-01-04",
      "Ferritina: 45.5 ng/mL",
      "Ureia: 30 mg/dL",
    ].join("\n");
    const pages = [{ page: 1, text: headers }];
    const recovered = recoverLaboratoryDates([row()], pages);
    expect(recovered.rows[0]).toMatchObject({
      collectedOn: "2026-01-02",
      reportedOn: "2026-01-04",
      issuedOn: null,
    });
    expect(checkLaboratoryEvidence(recovered.rows[0]!, pages).fields.collectedOn).toEqual({
      status: "supported",
      page: 1,
      line: 6,
    });
    const other = headers.replace(
      "Ferritina: 45.5 ng/mL",
      "Glicose: 90 mg/dL\nColeta: 2026-01-10\nFerritina: 45.5 ng/mL",
    );
    expect(
      recoverLaboratoryDates([row()], [{ page: 1, text: other }]).rows[0]!.collectedOn,
    ).toBeNull();
    expect(checkLaboratoryEvidence(row(), pages).issues).toContain("FIELD_OMITTED");
    expect(
      checkLaboratoryEvidence(row({ name: "Página", result: "1", unit: null, evidence: null }), [
        { page: 1, text: "Página: 1\nColeta: 2026-01-02\nGlicose: 90 mg/dL" },
      ]).status,
    ).toBe("attention");
  });
  it("does not carry an earlier laboratory/date header across an intervening metadata block", () => {
    const page = [
      {
        page: 1,
        text: "Laboratório: Laboratório A\nColeta: 2026-01-15\nGlicose: 90 mg/dL\nLaboratório: Laboratório B\nColeta: 2026-02-20\nUreia: 30 mg/dL",
      },
    ];
    const ureia = row({
      name: "Ureia",
      result: "30",
      unit: "mg/dL",
      laboratory: "Laboratório A",
      evidence: "Ureia: 30 mg/dL",
    });
    const recovered = recoverLaboratoryDates([ureia], page);
    expect(recovered.recoveries).toEqual([]);
    expect(recovered.rows[0]!.collectedOn).toBeNull();
    const check = checkLaboratoryEvidence(recovered.rows[0]!, page);
    expect(check.status).toBe("attention");
    expect(check.fields.laboratory.status).toBe("insufficient");
    expect(check.fields.collectedOn.status).not.toBe("supported");
    expect(check.issues).toContain("METADATA_SCOPE_AMBIGUOUS");
    const omitted = { ...ureia, laboratory: null };
    expect(checkLaboratoryEvidence(omitted, page)).toMatchObject({
      status: "attention",
      issues: expect.arrayContaining(["METADATA_SCOPE_AMBIGUOUS"]),
      fields: { collectedOn: { status: "insufficient" }, laboratory: { status: "insufficient" } },
    });
    expect(recoverLaboratoryDates([omitted], page).recoveries).toEqual([]);
    // Neither lab is silently assigned when the block layout is unproven.
    expect(
      checkLaboratoryEvidence(
        { ...ureia, laboratory: "Laboratório B", collectedOn: "2026-02-20" },
        page,
      ).status,
    ).toBe("attention");
    const direct = [
      {
        page: 1,
        text: "Laboratório: Laboratório A\nColeta: 2026-01-15\nGlicose: 90 mg/dL\nUreia: 30 mg/dL\nTSH: 2 mUI/L",
      },
    ];
    const three = recoverLaboratoryDates(
      [
        row({ name: "Glicose", result: "90", unit: "mg/dL" }),
        row({ name: "Ureia", result: "30", unit: "mg/dL" }),
        row({ name: "TSH", result: "2", unit: "mUI/L" }),
      ],
      direct,
    );
    expect(three.rows.map((item) => item.collectedOn)).toEqual([
      "2026-01-15",
      "2026-01-15",
      "2026-01-15",
    ]);
    expect(three.recoveries).toHaveLength(3);
  });
  it.each(["Laboratório: Laboratório B\nColeta: 2026-02-20", "Coleta: 2026-02-20"])(
    "does not attach the inter-observation block %s backwards to the preceding analyte",
    (block) => {
      const pages = [{ page: 1, text: `Glicose: 90 mg/dL\n${block}\nUreia: 30 mg/dL` }];
      const glucose = row({
        name: "Glicose",
        result: "90",
        unit: "mg/dL",
        laboratory: block.startsWith("Laboratório") ? "Laboratório B" : null,
        evidence: "Glicose: 90 mg/dL",
      });
      expect(recoverLaboratoryDates([glucose], pages).recoveries).toEqual([]);
      expect(checkLaboratoryEvidence(glucose, pages)).toMatchObject({
        status: "attention",
        issues: expect.arrayContaining(["METADATA_SCOPE_AMBIGUOUS"]),
        fields: { collectedOn: { status: "insufficient" } },
      });
      expect(checkLaboratoryEvidence({ ...glucose, laboratory: null }, pages).issues).toContain(
        "METADATA_SCOPE_AMBIGUOUS",
      );
      const eof = [{ page: 1, text: `Glicose: 90 mg/dL\n${block}` }];
      const recovered = recoverLaboratoryDates([glucose], eof);
      expect(recovered.rows[0]!.collectedOn).toBe("2026-02-20");
      expect(recovered.recoveries).toHaveLength(1);
      expect(checkLaboratoryEvidence(recovered.rows[0]!, eof).status).toBe("literal_match");
    },
  );
});
