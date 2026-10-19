/** Commercial proposal from an already-authorized, allowlisted immutable quote revision. */
const escape = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const money = (value: unknown) =>
  typeof value === "string" && /^\d+\.\d{2}$/.test(value)
    ? `R$ ${BigInt(value.split(".")[0]!).toLocaleString("pt-BR")},${value.split(".")[1]}`
    : "Pendente";
export function renderPlanQuoteProposal(
  value: unknown,
  context: { quoteId: string; revision: number; patientName: string },
) {
  const snapshot = record(value),
    lines = Array.isArray(snapshot["lines"]) ? snapshot["lines"].map(record) : [];
  const rows = lines
    .map((line) => {
      const status = line["status"],
        description =
          status === "INCLUDED"
            ? "Incluído, sem cobrança separada"
            : status === "EXCLUDED"
              ? "Não selecionado"
              : status === "UNRESOLVED"
                ? "Pendente de definição"
                : "Calculado";
      return `<tr><td>${escape(line["label"])}</td><td>${escape(line["quantity"] ?? "Não informada")} ${escape(line["unit"])}</td><td>${escape(money(line["unitPrice"]))}</td><td>${escape(status === "INCLUDED" ? "Incluído" : status === "EXCLUDED" ? "Não selecionado" : money(line["subtotal"]))}</td><td>${escape(description)}</td><td>${escape(line["priceSource"] ?? "Origem não informada")}<br>Preço v${escape(line["priceVersion"] ?? "não informada")}<br>${escape(line["validFrom"] ?? "Vigência não informada")} até ${escape(line["validUntil"] ?? "sem data final")}</td></tr>`;
    })
    .join("");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>Proposta comercial — estimativa</title><style>body{font:15px system-ui,sans-serif;color:#173c37;margin:32px;max-width:1100px}.notice{padding:16px;border:2px solid #8b6600;background:#fff9dc}h1{margin-bottom:8px}table{width:100%;border-collapse:collapse;margin:24px 0}td,th{padding:10px;text-align:left;border-bottom:1px solid #cbd5d2;vertical-align:top}.totals{font-size:18px}small{color:#40534e}@media print{body{margin:16mm}.notice{background:white}tr{break-inside:avoid}}</style></head><body><h1>Proposta comercial</h1><p class="notice"><strong>ESTIMATIVA — NÃO APROVADA</strong><br>Esta proposta não confirma venda, pagamento, reserva de estoque ou agendamento.</p><p>Destinatário (cadastro atual): ${escape(context.patientName)}<br>Unidade: ${escape(snapshot["unitName"] ?? snapshot["unitId"] ?? "Unidade registrada na estimativa")}<br>Estimativa ${escape(context.quoteId)} · revisão ${escape(context.revision)}<br>Referência de preços: ${escape(snapshot["referenceDate"])} · plano salvo v${escape(snapshot["sourcePlanVersion"] ?? snapshot["planVersion"])}</p><table><thead><tr><th>Item comercial</th><th>Quantidade</th><th>Preço unitário</th><th>Subtotal</th><th>Situação</th><th>Origem e vigência</th></tr></thead><tbody>${rows}</tbody></table><div class="totals"><p>Subtotal conhecido: <strong>${escape(money(snapshot["knownSubtotal"]))}</strong></p><p>Desconto: <strong>${escape(money(snapshot["discountAmount"]))}</strong></p><p>Total da estimativa: <strong>${escape(money(snapshot["total"]))}</strong></p></div>${snapshot["complete"] === true ? "" : '<p class="notice">Há itens pendentes. O subtotal conhecido não representa o valor completo do plano; pendências não equivalem a zero.</p>'}<small>Documento comercial baseado exclusivamente na revisão salva indicada. Alterações posteriores de preços ou do plano não recalculam este documento. Não é receita médica nem documento assinado digitalmente. Para imprimir ou salvar em PDF, use a opção de impressão do navegador.</small></body></html>`;
}
