import { describe, it, expect } from "vitest";
import catalog from "../server/vendor-catalog/stin.json";
import { cents } from "../data/order-export";
describe("Stin source transcription", () => {
  it("preserves the 118 presentations and their verified acquisition price", () => {
    expect(catalog.supplier).toEqual({ name: "Stin Pharma", phone: "551120781800" });
    expect(catalog.edition).toBe("03.2026");
    expect(catalog.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    const products = catalog.items.filter((i) => i.kind === "PRODUCT");
    expect(products).toHaveLength(118);
    expect(new Set(catalog.items.map((i) => i.code)).size).toBe(119);
    for (const [n, item] of products.slice(0, 115).entries()) {
      expect(item.code).toBe(`STIN-P${String(n + 1).padStart(3, "0")}`);
      expect(item.boxesPerPack).toBe(1);
      expect(item.supplierSku).toBeNull();
      const unit = item.description.match(
        /Preço unitário informado no catálogo: R\$ ([0-9,]+)/,
      )![1]!;
      expect(cents(unit.replace(",", ".")) * 10n).toBe(cents(item.price));
    }
    expect(products.slice(115).map((item) => item.code)).toEqual([
      "STIN-TIRZ-20",
      "STIN-TIRZ-60",
      "STIN-TIRZ-93_6",
    ]);
  });
  it("prices the kit once, retaining all five phase descriptions and source uncertainties", () => {
    const kit = catalog.items.find((i) => i.kind === "KIT")!;
    expect(kit).toMatchObject({
      code: "STIN-K001",
      price: "499.00",
      contents: "5 frascos + 1 ampola",
      boxesPerPack: null,
    });
    for (let n = 1; n <= 5; n++) expect(kit.description).toContain(`STIN-K001-F${n}`);
    expect(kit.description).toContain("Crisina 100cmg/ml");
    expect(kit.description).toContain("PN 1%");
    expect(catalog.items.find((i) => i.code === "STIN-P075")!.contents).toContain("conteúdo 50mg");
    expect(catalog.items.find((i) => i.code === "STIN-P075")!.contents).not.toContain("50ml");
    expect(
      catalog.items.filter((i) => i.description.includes("Pendência de cadastro:")),
    ).toHaveLength(6);
  });
});
