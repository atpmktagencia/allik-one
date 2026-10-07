import { describe, it, expect } from "vitest";
import { cents, decimalMoney, orderCsv, orderHtml, orderMessage } from "../data/order-export";
import { supplierOrderInput, supplierProfileInput } from "../data/supplier-input";
import type { SupplierOrder } from "../data/supplier-input";
const id = "00000000-0000-4000-8000-000000000001";
const sample: SupplierOrder = {
  id,
  reference: '=HYPERLINK("evil")',
  supplier: { id, name: "Essentia", phone: "554888029876", email: null, active: true, version: 0 },
  items: [
    {
      catalogItemId: id,
      productId: id,
      code: "ESS-P092",
      supplierSku: null,
      name: "Vitamina <script>alert(1)</script>",
      packaging: "Conjunto de 2 boxes",
      contents: "20 ampolas",
      quantity: 2,
      boxes: 4,
      price: "378.00",
      subtotal: "756.00",
      priceSource: "Catálogo 04.2026",
    },
  ],
  subtotal: "756.00",
  freight: null,
  total: "756.00",
  notes: '@SUM(A1)\nTexto "literal";',
  actor: "preview-operator",
  date: "2026-10-04T00:00:00Z",
};
describe("commercial order exports", () => {
  it("uses exact cents for fractional values and large totals", () => {
    expect(decimalMoney(cents("0.10") * 3n + cents("0.20"))).toBe("0.50");
    expect(decimalMoney(cents("9999999999.99") * 9999n)).toBe("99989999999900.01");
  });
  it("quotes CSV, adds BOM and neutralizes spreadsheet formulas", () => {
    const csv = orderCsv(sample);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('"\'=HYPERLINK(""evil"")"');
    expect(csv).toContain("\"'@SUM(A1)");
    expect(csv).toContain('"2";"4";"378,00";"756,00"');
  });
  it("escapes HTML and accurately describes grouped boxes, internal codes and unquoted freight", () => {
    const html = orderHtml(sample);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    const message = orderMessage(sample);
    expect(message).toContain("2 apresentação(ões) · 4 box(es)");
    expect(message).toContain("SKU oficial não informado");
    expect(message).toContain("a confirmar, não incluído");
  });
  it("normalizes the exact supplied contact and rejects fractional pack quantities or injected totals", () => {
    expect(
      supplierProfileInput.parse({
        operationId: id,
        id,
        action: "CREATE",
        name: "Essentia",
        phone: "+55 48 8802-9876",
        email: "",
        active: true,
      }).phone,
    ).toBe("554888029876");
    const base = {
      operationId: id,
      reference: "PO-1",
      supplierId: id,
      supplierVersion: 0,
      freight: null,
      notes: "",
      items: [{ catalogItemId: id, version: 0, quantity: 1, expectedPrice: "378" }],
    };
    expect(supplierOrderInput.safeParse(base).success).toBe(true);
    expect(supplierOrderInput.safeParse({ ...base, total: 1 }).success).toBe(false);
    expect(
      supplierOrderInput.safeParse({ ...base, items: [{ ...base.items[0], quantity: 1.5 }] })
        .success,
    ).toBe(false);
  });
});
