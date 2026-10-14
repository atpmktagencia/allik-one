import { describe, expect, it } from "vitest";
import { patientPrintDefaults, prescriptionPrintDataSchema } from "./prescription-print-data";
import { renderClinicalDocumentPrint } from "../server/clinical-document-print";

const document = {
  type: "PRESCRIPTION",
  status: "DRAFT",
  title: "RECEITA MÉDICA",
  content: "Instruções sintéticas",
  full_name: "Paciente sintético",
  internal_code: "TEST-1",
  unit_name: "Fortaleza",
  author_name: "Profissional sintético",
  professional_council: "CRM",
  council_number: "123",
  council_region: "CE",
  updated_at: "2031-01-01T12:00:00Z",
  two_copies: true,
};

describe("prescription printing metadata", () => {
  it("derives known patient data and age in the clinic timezone without inventing missing fields", () => {
    const data = patientPrintDefaults(
      {
        birth_date: "2000-01-01",
        document_number: "synthetic",
        additional_data: {
          address: "Rua teste",
          city: "Fortaleza",
          state: "CE",
          profession: "Must not leak",
        },
      },
      new Date("2030-01-01T01:00:00Z"),
    );
    expect(data).toMatchObject({
      patientAge: 29,
      patientDocument: "synthetic",
      patientAddress: "Rua teste, Fortaleza, CE",
      patientSex: "",
      issuerAddress: "",
    });
    expect(patientPrintDefaults({}).patientAge).toBeNull();
    expect(prescriptionPrintDataSchema.safeParse({ patientAge: -1 }).success).toBe(false);
    expect(prescriptionPrintDataSchema.safeParse({ kind: "CONTROLLED_UNKNOWN" }).success).toBe(
      false,
    );
  });
  it("prints two complete side-by-side copies with controlled buyer and supplier fields", () => {
    const html = renderClinicalDocumentPrint({
      ...document,
      prescription_print_data: {
        kind: "SPECIAL_CONTROL",
        patientAddress: "Rua teste",
        issuerAddress: "Clínica teste",
      },
    });
    expect(html).toContain("size:A4 landscape");
    expect(html).toContain("grid-template-columns:minmax(0,1fr) minmax(0,1fr)");
    expect(html).toContain("1ª VIA — RETENÇÃO DA FARMÁCIA");
    expect(html).toContain("2ª VIA — ORIENTAÇÃO AO PACIENTE");
    expect(html.match(/Identificação do comprador/g)).toHaveLength(2);
    expect(html.match(/Identificação do fornecedor/g)).toHaveLength(2);
    expect(html.match(/RECEITA DE CONTROLE ESPECIAL/g)).toHaveLength(3);
    expect(html).toContain("Não possui assinatura eletrônica");
  });
  it("uses the antimicrobial copy order and pharmacy dispensing fields", () => {
    const html = renderClinicalDocumentPrint({
      ...document,
      prescription_print_data: {
        kind: "ANTIMICROBIAL",
        patientAge: 35,
        patientSex: "Não informado",
      },
    });
    expect(html.indexOf("1ª VIA — PACIENTE")).toBeLessThan(
      html.indexOf("2ª VIA — RETENÇÃO DA FARMÁCIA"),
    );
    expect(html.match(/Preenchimento pela farmácia na dispensação/g)).toHaveLength(2);
    expect(html).toContain("Lote / rubrica do farmacêutico");
    expect(html).not.toContain("Identificação do comprador");
  });
  it("escapes metadata and freezes final data instead of consulting changed patient fields", () => {
    const html = renderClinicalDocumentPrint({
      ...document,
      status: "FINAL",
      full_name: "Current patient",
      prescription_print_data: { issuerAddress: "Current address" },
      final_snapshot: {
        patientName: "Frozen patient",
        patientCode: "TEST-FINAL",
        unitName: "Frozen unit",
        authorName: "Frozen clinician",
        professionalCouncil: "CRM",
        councilNumber: "456",
        councilRegion: "CE",
        title: "RECEITA MÉDICA",
        content: "<script>content</script>",
        twoCopies: false,
        finalizedAt: "2031-01-01T12:00:00Z",
        prescriptionPrintData: { issuerAddress: "<img src=x onerror=alert(1)>" },
      },
    });
    expect(html).toContain("Frozen patient");
    expect(html).not.toContain("Current patient");
    expect(html).not.toContain("Current address");
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>");
    expect(html).toContain("size:A4 portrait");
  });
});
