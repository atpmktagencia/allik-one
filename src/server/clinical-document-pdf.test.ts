import { describe, expect, it } from "vitest";
import { Buffer } from "node:buffer";
import { inflateSync } from "node:zlib";
import { renderClinicalDocumentPdf } from "./clinical-document-pdf";

function fixture(extra: Record<string, unknown> = {}) {
  return {
    status: "FINAL",
    final_snapshot: {
      snapshotVersion: 1,
      finalizedAt: "2026-10-14T12:00:00Z",
      title: "RECEITA MÉDICA",
      type: "PRESCRIPTION",
      content: "Texto preservado na finalização.",
      patientName: "Paciente preservado",
      patientCode: "ALL-001",
      unitName: "Fortaleza preservada",
      authorName: "Profissional preservado",
      professionalCouncil: "CRM",
      councilNumber: "12345",
      councilRegion: "CE",
      twoCopies: false,
      ...extra,
    },
  };
}
function streams(pdf: Buffer): string {
  const source = pdf.toString("latin1");
  const objects = new Map<string, string>();
  for (const match of source.matchAll(/(\d+) 0 obj\n([\s\S]*?)\nendobj/g)) {
    let body = match[2]!;
    const start = body.indexOf("stream\n"),
      end = body.lastIndexOf("endstream");
    if (start >= 0 && end > start) {
      const bytes = Buffer.from(body.slice(start + 7, end), "latin1");
      try {
        body = inflateSync(bytes).toString("latin1");
      } catch {
        /* Noncontent object. */
      }
    }
    objects.set(match[1]!, body);
  }
  const maps = new Map<string, Map<string, string>>();
  const utf16 = (hex: string) => {
    let text = "";
    for (let i = 0; i < hex.length; i += 4)
      text += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
    return text;
  };
  for (const ref of source.matchAll(/\/(F\d+) (\d+) 0 R/g)) {
    const font = objects.get(ref[2]!) ?? "";
    const cmapId = font.match(/\/ToUnicode (\d+) 0 R/)?.[1];
    const cmap = objects.get(cmapId ?? "") ?? "";
    const map = new Map<string, string>();
    for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))
      for (const pair of block[1]!.matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>/gi))
        map.set(pair[1]!.toLowerCase(), utf16(pair[2]!));
    for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
      for (const range of block[1]!.matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*\[([^\]]*)\]/gi)) {
        let code = parseInt(range[1]!, 16);
        for (const value of range[3]!.matchAll(/<([0-9a-f]+)>/gi))
          map.set((code++).toString(16).padStart(4, "0"), utf16(value[1]!));
      }
    }
    maps.set(ref[1]!, map);
  }
  let result = "";
  for (const body of objects.values()) {
    if (!body.includes(" TJ")) continue;
    let font = "";
    for (const token of body.matchAll(/\/(F\d+) [\d.]+ Tf|\[([^\]]*)\] TJ/g)) {
      if (token[1]) {
        font = token[1];
        continue;
      }
      for (const chunk of (token[2] ?? "").matchAll(/<([0-9a-f]+)>/gi)) {
        const hex = chunk[1]!;
        for (let i = 0; i < hex.length; i += 4)
          result += maps.get(font)?.get(hex.slice(i, i + 4).toLowerCase()) ?? "";
      }
    }
  }
  return result;
}

describe("immutable clinical signing PDF", () => {
  it("rejects drafts and legacy documents without frozen identity", async () => {
    await expect(renderClinicalDocumentPdf({ status: "DRAFT" })).rejects.toThrow();
    await expect(
      renderClinicalDocumentPdf({ status: "FINAL", patient_name: "Current patient" }),
    ).rejects.toThrow();
  });
  it("preserves amendment references and paginates long reasons in two copies", async () => {
    const source = fixture({
      twoCopies: true,
      amendment: {
        parentDocumentId: "document-original-reference",
        kind: "RECTIFICATION",
        reason: "Motivo confirmado ".repeat(100),
        parentSha256: "a".repeat(64),
      },
    });
    const pdf = await renderClinicalDocumentPdf(source);
    const text = streams(pdf);
    expect(text).toContain("document-original-reference");
    expect(text).toContain("RETIFICAÇÃO");
    expect(text).toContain("Motivo confirmado");
    expect(text).toContain("Texto preservado na finalização.");
  });
  it("renders deterministic bytes independent of current patient/profile values", async () => {
    const source = fixture();
    const first = await renderClinicalDocumentPdf(source);
    const second = await renderClinicalDocumentPdf({
      ...source,
      patient_name: "Changed current patient",
      author_name: "Another professional",
      content: "Changed mutable outside snapshot",
    });
    expect(first.subarray(0, 5).toString()).toBe("%PDF-");
    expect(first.equals(second)).toBe(true);
    const commands = streams(first);
    expect(commands).toContain("Paciente preservado");
    expect(commands).not.toContain("Changed current patient");
  });
  it("puts two complete copies on a landscape A4 sheet", async () => {
    const pdf = await renderClinicalDocumentPdf(fixture({ twoCopies: true }));
    expect(pdf.toString("latin1")).toMatch(/\/MediaBox \[0 0 841\.89 595\.28\]/);
    const commands = streams(pdf);
    const patient = "Paciente preservado";
    expect(commands.split(patient).length - 1).toBe(2);
    expect(pdf.toString("latin1").match(/\/Type \/Page\b/g)).toHaveLength(1);
  });
  it("preserves bold/italic/underline and paginates long text without dropping last paragraph", async () => {
    const paragraphs = Array.from({ length: 160 }, (_, i) => ({
      type: "paragraph",
      content: [
        {
          type: "text",
          text: `Parágrafo ${i + 1}: conteúdo clínico preservado para documento longo.`,
          marks: [{ type: "bold" }, { type: "italic" }, { type: "underline" }],
        },
      ],
    }));
    const pdf = await renderClinicalDocumentPdf(
      fixture({ content: "Conteúdo longo", richContent: { type: "doc", content: paragraphs } }),
    );
    const raw = pdf.toString("latin1");
    expect(raw.match(/\/Type \/Page\b/g)!.length).toBeGreaterThan(1);
    expect(raw).toContain("LiberationSans-BoldItalic");
    expect(streams(pdf)).toContain("160:");
  });
  it("preserves medical Unicode symbols and Greek names in the embedded font", async () => {
    const text = "μ ≥ ≤ → µ α β Ω";
    const row = fixture({
      patientName: "Αλέξανδρος",
      content: text,
      richContent: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text, marks: [{ type: "bold" }, { type: "italic" }] }],
          },
        ],
      },
    });
    const pdf = await renderClinicalDocumentPdf(row);
    expect(pdf.equals(await renderClinicalDocumentPdf(row))).toBe(true);
    expect(pdf.toString("latin1")).toContain("/FontFile2");
    expect(streams(pdf)).toContain(text);
    expect(streams(pdf)).toContain("Αλέξανδρος");
  });
  it("fails closed for unsupported glyphs instead of silently changing clinical text", async () => {
    await expect(renderClinicalDocumentPdf(fixture({ content: "医" }))).rejects.toThrow(/U\+533B/);
  });
});
