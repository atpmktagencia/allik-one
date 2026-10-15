import {
  escapeDocumentHtml as escapeHtml,
  renderRichContentHtml,
  richContentSchema,
} from "../lib/clinical-document-content";
import { prescriptionPrintDataSchema } from "../lib/prescription-print-data";

type PrintDocument = Record<string, unknown>;
/** Uses frozen identity/content/print metadata for finalized documents, never current patient metadata. */
export function renderClinicalDocumentPrint(doc: PrintDocument): string {
  const snapshot = doc["final_snapshot"] as Record<string, unknown> | null;
  const rendered = snapshot
    ? {
        ...doc,
        full_name: snapshot["patientName"],
        internal_code: snapshot["patientCode"],
        unit_name: snapshot["unitName"],
        author_name: snapshot["authorName"],
        professional_council: snapshot["professionalCouncil"],
        council_number: snapshot["councilNumber"],
        council_region: snapshot["councilRegion"],
        title: snapshot["title"],
        content: snapshot["content"],
        rich_content: snapshot["richContent"] ?? null,
        two_copies: snapshot["twoCopies"] ?? false,
        prescription_print_data: snapshot["prescriptionPrintData"] ?? null,
        finalized_at: snapshot["finalizedAt"],
      }
    : doc;
  const metadata = prescriptionPrintDataSchema.parse(rendered["prescription_print_data"] ?? {});
  const prescription = doc["type"] === "PRESCRIPTION";
  const special = prescription && metadata.kind === "SPECIAL_CONTROL";
  const antimicrobial = prescription && metadata.kind === "ANTIMICROBIAL";
  const twoCopies = prescription && Boolean(rendered["two_copies"]);
  const draft = doc["status"] !== "FINAL";
  const title = special ? "RECEITA DE CONTROLE ESPECIAL" : rendered["title"];
  const bodyHtml = rendered["rich_content"]
    ? renderRichContentHtml(richContentSchema.parse(rendered["rich_content"]))
    : `<div class="plain">${escapeHtml(rendered["content"])}</div>`;
  const field = (label: string, value: unknown) =>
    `<div class="field"><b>${escapeHtml(label)}:</b> ${value === null || value === undefined || value === "" ? '<span class="blank">________________________</span>' : escapeHtml(value)}</div>`;
  const amendment = (snapshot ? snapshot["amendment"] : doc["amendment"]) as
    Record<string, unknown> | undefined;
  const amendmentNotice = amendment
    ? `<aside class="warning"><strong>${amendment["kind"] === "ADDENDUM" ? "ADENDO" : "RETIFICAÇÃO"}</strong>${field("Documento original", amendment["parentDocumentId"])}${field("Motivo", amendment["reason"])}${field("SHA-256 do original", amendment["parentSha256"])}</aside>`
    : "";
  const professional = `${rendered["author_name"] ?? ""} · ${rendered["professional_council"] ?? ""} ${rendered["council_number"] ?? ""}/${rendered["council_region"] ?? ""}`;
  const prescriptionFields = prescription
    ? `<div class="prescriber"><strong>Identificação do emitente</strong>${field("Profissional / conselho", professional)}${field("Endereço", metadata.issuerAddress)}${field("Cidade / UF", [metadata.issuerCity, metadata.issuerState].filter(Boolean).join(" / "))}${field("Telefone", metadata.issuerPhone)}</div>`
    : "";
  const identity = snapshot?.["patientIdentity"] as Record<string, unknown> | undefined;
  const canonicalPatientFields = identity
    ? `${field("CPF / passaporte", identity["documentNumber"])}${field("Data de nascimento", typeof identity["birthDate"] === "string" ? identity["birthDate"].split("-").reverse().join("/") : "")}${field("Endereço do paciente", identity["address"])}`
    : "";
  const verification = snapshot?.["verificationCode"]
    ? `<p class="notice">Código de verificação: ${escapeHtml(snapshot["verificationCode"])}</p><p class="notice">Conferência interna no Allik One, com acesso autorizado. O código não comprova assinatura digital.</p>`
    : "";
  const patientFields = identity
    ? canonicalPatientFields +
      (prescription && !special
        ? field("Idade (anos)", metadata.patientAge) + field("Sexo", metadata.patientSex)
        : "")
    : prescription
      ? `${field("CPF / passaporte", metadata.patientDocument)}${field("Endereço do paciente", metadata.patientAddress)}${special ? "" : field("Idade (anos)", metadata.patientAge) + field("Sexo", metadata.patientSex)}`
      : "";
  const dispensingFields = special
    ? `<div class="dispensing"><section><strong>Identificação do comprador (preenchimento pela farmácia)</strong>${field("Nome", "")}${field("CPF / passaporte", "")}${field("Endereço", "")}${field("Cidade / UF / telefone", "")}</section><section><strong>Identificação do fornecedor</strong>${field("Farmácia / CNPJ ou CNES", "")}${field("Responsável / assinatura", "")}${field("Medicamento / apresentação / lote", "")}${field("Registro do receituário (se manipulado)", "")}${field("Data / quantidade dispensada", "")}</section></div>`
    : antimicrobial
      ? `<div class="dispensing"><section><strong>Preenchimento pela farmácia na dispensação</strong>${field("Data / quantidade dispensada", "")}${field("Lote / rubrica do farmacêutico", "")}</section></div>`
      : "";
  const timestamp = new Date(String(draft ? doc["updated_at"] : rendered["finalized_at"]));
  const date = Number.isNaN(timestamp.getTime())
    ? ""
    : timestamp.toLocaleDateString("pt-BR", { timeZone: "America/Fortaleza" });
  const copy = (label: string) =>
    `<section class="document-copy"><header><div class="brand">Allik One · ${escapeHtml(rendered["unit_name"])}</div>${label ? `<div class="copy-label">${label}</div>` : ""}${draft ? '<div class="warning">RASCUNHO — NÃO FINALIZADO</div>' : ""}<h1>${escapeHtml(title)}</h1>${prescriptionFields}${field("Paciente", rendered["full_name"])}${field("Código", rendered["internal_code"])}${patientFields}${amendmentNotice}</header><article>${bodyHtml}</article><footer>${prescription ? field("Data de emissão", date) : `<p>${escapeHtml(professional)} · ${escapeHtml(date)}</p>`}${prescription ? '<div class="signature">Assinatura do profissional: ______________________________</div>' : ""}<p class="notice">${draft ? "Documento em rascunho." : "Documento finalizado no sistema."} Não possui assinatura eletrônica. A validade do documento exige assinatura profissional adequada.</p>${!snapshot && !draft ? '<p class="notice">Documento legado: cabeçalho do paciente e da unidade usa o cadastro atual; não foi congelado na finalização.</p>' : ""}${dispensingFields}${verification}</footer></section>`;
  const copies = twoCopies
    ? copy(special ? "1ª VIA — RETENÇÃO DA FARMÁCIA" : "1ª VIA — PACIENTE") +
      copy(special ? "2ª VIA — ORIENTAÇÃO AO PACIENTE" : "2ª VIA — RETENÇÃO DA FARMÁCIA")
    : copy("");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>
  *{box-sizing:border-box}body{font:13px Arial,sans-serif;color:#000;background:#fff;margin:24px auto;max-width:${twoCopies ? "1160" : "800"}px;padding:0 20px}main{${twoCopies ? "display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12mm" : ""}}.document-copy{min-width:0}.document-copy+.document-copy{border-left:1px dashed #aaa;padding-left:6mm}.brand,.copy-label{font-size:11px}.copy-label{text-align:right;font-weight:bold;margin:5px 0}h1{text-align:center;font-size:${twoCopies ? "18" : "24"}px;margin:12px 0}.field{margin:4px 0;overflow-wrap:anywhere}.prescriber{border:1px solid #777;padding:7px;margin-bottom:8px}article{line-height:1.45;margin:14px 0;overflow-wrap:anywhere}.plain{white-space:pre-wrap}article p{margin:0 0 .65em}article li p{margin:0}footer{border-top:1px solid #bbb;padding-top:8px;font-size:11px}.signature{margin:14px 0}.notice{font-size:9px}.warning{font-weight:bold;margin:6px 0}.dispensing{border:1px solid #888;padding:7px;margin-top:8px;font-size:10px}.dispensing section+section{border-top:1px solid #aaa;margin-top:8px;padding-top:8px}@page{size:A4 ${twoCopies ? "landscape" : "portrait"};margin:10mm}@media print{body{margin:0;padding:0;max-width:none;font-size:${twoCopies ? "11" : "13"}px}main{gap:10mm}.document-copy+.document-copy{padding-left:5mm}h1,h2,h3,.prescriber,.dispensing{break-inside:avoid}p{orphans:2;widows:2}}@media screen and (max-width:650px){main{display:block}.document-copy+.document-copy{border-left:0;border-top:1px dashed #aaa;padding-left:0;padding-top:20px;margin-top:20px}}</style></head><body><main>${copies}</main></body></html>`;
}
