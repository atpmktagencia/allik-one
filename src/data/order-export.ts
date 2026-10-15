import type { SupplierOrder } from "./supplier-input";

export function cents(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0"));
}
export function decimalMoney(value: bigint) {
  return `${value / 100n}.${(value % 100n).toString().padStart(2, "0")}`;
}
export function money(value: string) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    Number(value),
  );
}
function csvCell(value: unknown) {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return `"${text.replaceAll('"', '""')}"`;
}
export function orderCsv(order: SupplierOrder) {
  const rows: unknown[][] = [
    [
      "Pedido",
      "Fornecedor",
      "Código interno",
      "SKU fornecedor",
      "Produto",
      "Apresentação",
      "Conteúdo",
      "Quantidade apresentações",
      "Boxes físicos",
      "Preço apresentação (BRL)",
      "Subtotal (BRL)",
      "Fonte do preço",
    ],
  ];
  for (const i of order.items)
    rows.push([
      order.reference,
      order.supplier.name,
      i.code,
      i.supplierSku ?? "Não informado",
      i.name,
      i.packaging,
      i.contents,
      i.quantity,
      i.boxes ?? "Não informado",
      i.price.replace(".", ","),
      i.subtotal.replace(".", ","),
      i.priceSource,
    ]);
  rows.push(
    ["Subtotal", order.subtotal.replace(".", ",")],
    ["Frete", order.freight?.replace(".", ",") ?? "Não informado"],
    ["Total estimado", order.total.replace(".", ",")],
    ["Observações", order.notes],
  );
  return "\uFEFF" + rows.map((row) => row.map(csvCell).join(";")).join("\r\n");
}
export function orderMessage(order: SupplierOrder) {
  return [
    `Pedido ${order.reference}`,
    "Empresa: Allik Fortaleza",
    `Fornecedor: ${order.supplier.name}`,
    "",
    ...order.items.flatMap((i, n) => [
      `${n + 1}. ${i.name}`,
      `Código interno: ${i.code}${i.supplierSku ? ` | SKU fornecedor: ${i.supplierSku}` : " (SKU oficial não informado)"}`,
      `Apresentação: ${i.packaging}`,
      `Conteúdo: ${i.contents}`,
      `Quantidade: ${i.quantity} apresentação(ões)${i.boxes === null ? "" : ` · ${i.boxes} box(es)`}`,
      `Preço por apresentação: ${money(i.price)} | Subtotal: ${money(i.subtotal)}`,
      "",
    ]),
    `Subtotal dos produtos: ${money(order.subtotal)}`,
    `Frete: ${order.freight === null ? "a confirmar, não incluído" : money(order.freight)}`,
    `Total estimado: ${money(order.total)}`,
    ...(order.notes ? [`Observações: ${order.notes}`] : []),
    "Favor confirmar preços, disponibilidade, frete e condições do pedido.",
  ].join("\n");
}
const escapeHtml = (v: unknown) =>
  String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
export function orderHtml(order: SupplierOrder) {
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>${escapeHtml(order.reference)}</title><style>body{font:14px system-ui;margin:36px;color:#172033}h1{font-size:24px}pre{font:inherit;white-space:pre-wrap;line-height:1.6}button{padding:10px 16px;border:1px solid #ddd;border-radius:6px;background:white;cursor:pointer}@media print{button{display:none}body{margin:12mm}}</style><h1>Pedido de compra · Allik Fortaleza</h1><button onclick="window.print()">Imprimir / salvar PDF</button><pre>${escapeHtml(orderMessage(order))}</pre></html>`;
}
