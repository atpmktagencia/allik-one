// Package exports hide this distribution; the explicit file import lets the server
// bundler include embedded standard fonts instead of dynamic package-relative loaders.
import PDFDocument from "../../node_modules/pdfkit/js/pdfkit.standalone.js";
import { clinicalDocumentFonts } from "./clinical-document-fonts";
import {
  plainTextRichContent,
  richContentSchema,
  type RichContentNode,
} from "../lib/clinical-document-content";
import { prescriptionPrintDataSchema } from "../lib/prescription-print-data";

type Run = { text: string; font: string; underline: boolean };
type Line = {
  runs: Run[];
  size: number;
  align: "left" | "center" | "right" | "justify";
  indent: number;
  after: number;
};
const MAX_PDF_BYTES = 5 * 1024 * 1024;
const text = (value: unknown) => String(value ?? "");
const fontOf = (node: RichContentNode) => {
  const marks = node.marks ?? [];
  const bold = marks.some((m) => m.type === "bold");
  const italic = marks.some((m) => m.type === "italic");
  return bold
    ? italic
      ? "Allik-BoldItalic"
      : "Allik-Bold"
    : italic
      ? "Allik-Italic"
      : "Allik-Regular";
};

/** Immutable signing source: no current patient/profile values, network calls or user HTML. */
export async function renderClinicalDocumentPdf(
  document: Record<string, unknown>,
): Promise<Buffer> {
  const snapshot = document["final_snapshot"] as Record<string, unknown> | null;
  if (document["status"] !== "FINAL" || !snapshot || snapshot["snapshotVersion"] !== 1) {
    throw new Error("A assinatura exige documento finalizado com identificação preservada.");
  }
  const finalizedAt = new Date(text(snapshot["finalizedAt"]));
  if (!Number.isFinite(finalizedAt.getTime())) throw new Error("Data de finalização inválida.");
  const metadata = prescriptionPrintDataSchema.parse(snapshot["prescriptionPrintData"] ?? {});
  const prescription = snapshot["type"] === "PRESCRIPTION";
  const special = prescription && metadata.kind === "SPECIAL_CONTROL";
  const antimicrobial = prescription && metadata.kind === "ANTIMICROBIAL";
  const twoCopies = prescription && snapshot["twoCopies"] === true;
  const title = special ? "RECEITA DE CONTROLE ESPECIAL" : text(snapshot["title"]);
  let rich = snapshot["richContent"]
    ? richContentSchema.parse(snapshot["richContent"])
    : plainTextRichContent(text(snapshot["content"]));
  const amendment = snapshot["amendment"] as Record<string, unknown> | undefined;
  if (amendment)
    rich = {
      type: "doc",
      content: [
        ...(plainTextRichContent(
          `${amendment["kind"] === "ADDENDUM" ? "ADENDO" : "RETIFICAÇÃO"}\nDocumento original: ${text(amendment["parentDocumentId"])}\nMotivo: ${text(amendment["reason"])}\nSHA-256 do original: ${text(amendment["parentSha256"])}`,
        ).content ?? []),
        ...(rich.content ?? []),
      ],
    };
  if (text(snapshot["content"]).length > 30000) throw new Error("Documento muito extenso.");
  const pdf = new PDFDocument({
    size: "A4",
    layout: twoCopies ? "landscape" : "portrait",
    margin: 0,
    autoFirstPage: false,
    compress: true,
    info: {
      Title: title,
      Author: text(snapshot["authorName"]),
      Creator: "Allik One",
      Producer: "Allik One",
      CreationDate: finalizedAt,
      ModDate: finalizedAt,
    },
  });
  for (const [name, bytes] of Object.entries(clinicalDocumentFonts()))
    pdf.registerFont(name, bytes);
  const checkedGlyphs = new Map<string, Set<number>>();
  const requireGlyphs = (value: string, fontName: string) => {
    pdf.font(fontName);
    const embedded = (
      pdf as unknown as { _font: { font: { hasGlyphForCodePoint(codePoint: number): boolean } } }
    )._font.font;
    const checked = checkedGlyphs.get(fontName) ?? new Set<number>();
    checkedGlyphs.set(fontName, checked);
    for (const character of value) {
      const codePoint = character.codePointAt(0)!;
      if (checked.has(codePoint)) continue;
      if (!embedded.hasGlyphForCodePoint(codePoint))
        throw new Error(
          `O PDF não suporta o caractere U+${codePoint.toString(16).toUpperCase()}. Revise o documento antes de assinar.`,
        );
      checked.add(codePoint);
    }
  };
  requireGlyphs(title, "Allik-Bold");
  const chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => {
    let bytes = 0;
    pdf.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_PDF_BYTES) pdf.destroy(new Error("Documento excede o limite de tamanho."));
      else chunks.push(chunk);
    });
    pdf.on("error", reject);
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
  });
  const pageWidth = twoCopies ? 841.89 : 595.28;
  const pageHeight = twoCopies ? 595.28 : 841.89;
  const margin = 28;
  const gap = 28;
  const width = twoCopies ? (pageWidth - margin * 2 - gap) / 2 : pageWidth - margin * 2;
  const baseSize = twoCopies ? 10 : 12;
  const date = finalizedAt.toLocaleDateString("pt-BR", { timeZone: "America/Fortaleza" });
  const professional = `${text(snapshot["authorName"])} · ${text(snapshot["professionalCouncil"])} ${text(snapshot["councilNumber"])}/${text(snapshot["councilRegion"])}`;
  const field = (label: string, value: unknown) =>
    `${label}: ${value === null || value === undefined || value === "" ? "________________________" : text(value)}`;
  const header = [
    `Allik One · ${text(snapshot["unitName"])}`,
    ...(prescription
      ? [
          "Identificação do emitente",
          field("Profissional / conselho", professional),
          field("Endereço", metadata.issuerAddress),
          field(
            "Cidade / UF",
            [metadata.issuerCity, metadata.issuerState].filter(Boolean).join(" / "),
          ),
          field("Telefone", metadata.issuerPhone),
        ]
      : []),
    field("Paciente", snapshot["patientName"]),
    field("Código", snapshot["patientCode"]),
    ...(prescription
      ? [
          field("CPF / passaporte", metadata.patientDocument),
          field("Endereço do paciente", metadata.patientAddress),
          ...(!special
            ? [field("Idade (anos)", metadata.patientAge), field("Sexo", metadata.patientSex)]
            : []),
        ]
      : []),
  ];
  const footer = [
    professional,
    field("Data de emissão", date),
    "Assinatura do profissional: ______________________________",
    "Documento finalizado no sistema. Verifique a assinatura e sua validade no arquivo PDF.",
    ...(special
      ? [
          "Identificação do comprador — preenchimento pela farmácia",
          field("Nome", ""),
          field("CPF / passaporte", ""),
          field("Endereço", ""),
          field("Cidade / UF / telefone", ""),
          "Identificação do fornecedor",
          field("Farmácia / CNPJ ou CNES", ""),
          field("Responsável / assinatura", ""),
          field("Medicamento / apresentação / lote", ""),
          field("Registro do receituário (se manipulado)", ""),
          field("Data / quantidade dispensada", ""),
        ]
      : antimicrobial
        ? [
            "Preenchimento pela farmácia na dispensação",
            field("Data / quantidade dispensada", ""),
            field("Lote / rubrica do farmacêutico", ""),
          ]
        : []),
  ];
  const measure = (value: string, size: number, font = "Allik-Regular") => {
    requireGlyphs(value, font);
    return pdf.font(font).fontSize(size).widthOfString(value);
  };
  const wrap = (runs: Run[], size: number, available: number): Run[][] => {
    const lines: Run[][] = [[]];
    let used = 0;
    for (const run of runs) {
      for (const token of run.text.split(/(\n|[\t ]+)/)) {
        if (!token) continue;
        if (token === "\n") {
          lines.push([]);
          used = 0;
          continue;
        }
        const normalized = token.replace(/\t/g, "    ");
        if (used > 0 && used + measure(normalized, size, run.font) > available) {
          lines.push([]);
          used = 0;
        }
        // Split pathological unbroken words, keeping every character visible.
        let piece = "";
        for (const char of normalized) {
          if (piece && used + measure(piece + char, size, run.font) > available) {
            lines[lines.length - 1]!.push({ ...run, text: piece });
            lines.push([]);
            used = 0;
            piece = "";
          }
          piece += char;
        }
        if (piece) {
          lines[lines.length - 1]!.push({ ...run, text: piece });
          used += measure(piece, size, run.font);
        }
      }
    }
    return lines;
  };
  const lines: Line[] = [];
  const visit = (node: RichContentNode, indent = 0, prefix = "") => {
    if (node.type === "paragraph" || node.type === "heading") {
      const size =
        node.type === "heading" ? Math.max(baseSize + 1, 19 - (node.attrs?.level ?? 2)) : baseSize;
      const runs: Run[] = prefix ? [{ text: prefix, font: "Allik-Regular", underline: false }] : [];
      for (const child of node.content ?? []) {
        runs.push({
          text: child.type === "hardBreak" ? "\n" : (child.text ?? ""),
          font: node.type === "heading" ? "Allik-Bold" : fontOf(child),
          underline: child.marks?.some((m) => m.type === "underline") ?? false,
        });
      }
      const wrapped = wrap(runs, size, width - indent);
      wrapped.forEach((runLine, index) =>
        lines.push({
          runs: runLine,
          size,
          align:
            node.attrs?.textAlign === "justify" && index === wrapped.length - 1
              ? "left"
              : (node.attrs?.textAlign ?? "left"),
          indent,
          after: index === wrapped.length - 1 ? 5 : 0,
        }),
      );
    } else if (node.type === "bulletList" || node.type === "orderedList") {
      (node.content ?? []).forEach((item, index) =>
        (item.content ?? []).forEach((child, childIndex) =>
          visit(
            child,
            indent + 12,
            childIndex === 0
              ? node.type === "bulletList"
                ? "• "
                : `${(node.attrs?.start ?? 1) + index}. `
              : "",
          ),
        ),
      );
    } else (node.content ?? []).forEach((child) => visit(child, indent));
  };
  visit(rich);
  const smallSize = twoCopies ? 8 : 10;
  const simpleLines = (values: string[]) =>
    values.flatMap((value) =>
      wrap([{ text: value, font: "Allik-Regular", underline: false }], smallSize, width),
    );
  const headerLines = simpleLines(header);
  const footerLines = simpleLines(footer);
  const lineHeight = smallSize * 1.3;
  const headerHeight = 40 + headerLines.length * lineHeight;
  const footerHeight = footerLines.length * lineHeight + 12;
  const available = pageHeight - margin * 2 - headerHeight - footerHeight - 12;
  if (available < 30) throw new Error("Dados de identificação extensos demais para o documento.");
  const pages: Line[][] = [[]];
  let occupied = 0;
  for (const line of lines) {
    const height = line.size * 1.35 + line.after;
    if (occupied + height > available && pages[pages.length - 1]!.length) {
      pages.push([]);
      occupied = 0;
    }
    pages[pages.length - 1]!.push(line);
    occupied += height;
  }
  const drawRuns = (runs: Run[], x: number, y: number, size: number, extraSpace = 0) => {
    for (const run of runs) {
      pdf.font(run.font).fontSize(size).fillColor("black").text(run.text, x, y, {
        lineBreak: false,
        align: "left",
        characterSpacing: 0,
        wordSpacing: 0,
        underline: false,
      });
      const runWidth = measure(run.text, size, run.font);
      if (run.underline && runWidth > 0) {
        pdf
          .save()
          .strokeColor("black")
          .lineWidth(0.5)
          .moveTo(x, y + size * 1.05)
          .lineTo(x + runWidth, y + size * 1.05)
          .stroke()
          .restore();
      }
      x += runWidth + (run.text.match(/ /g)?.length ?? 0) * extraSpace;
    }
  };
  pages.forEach((pageLines, pageIndex) => {
    pdf.addPage();
    if (twoCopies)
      pdf
        .save()
        .strokeColor("#aaaaaa")
        .dash(3, { space: 3 })
        .moveTo(pageWidth / 2, margin)
        .lineTo(pageWidth / 2, pageHeight - margin)
        .stroke()
        .restore();
    for (let copy = 0; copy < (twoCopies ? 2 : 1); copy++) {
      const x = margin + copy * (width + gap);
      let y = margin;
      if (twoCopies) {
        const label = special
          ? copy === 0
            ? "1ª VIA — RETENÇÃO DA FARMÁCIA"
            : "2ª VIA — ORIENTAÇÃO AO PACIENTE"
          : copy === 0
            ? "1ª VIA — PACIENTE"
            : "2ª VIA — RETENÇÃO DA FARMÁCIA";
        pdf
          .font("Allik-Bold")
          .fontSize(smallSize)
          .text(label, x, y, { width, align: "right", lineBreak: false });
      }
      y += 14;
      pdf
        .font("Allik-Bold")
        .fontSize(twoCopies ? 14 : 18)
        .text(title, x, y, { width, align: "center", lineBreak: false });
      y += 26;
      for (const runLine of headerLines) {
        drawRuns(runLine, x, y, smallSize);
        y += lineHeight;
      }
      y += 6;
      for (const line of pageLines) {
        const length = line.runs.reduce(
          (total, run) => total + measure(run.text, line.size, run.font),
          0,
        );
        const availableWidth = width - line.indent;
        const offset =
          line.align === "center"
            ? (availableWidth - length) / 2
            : line.align === "right"
              ? availableWidth - length
              : 0;
        const spaces = line.runs.reduce(
          (total, run) => total + (run.text.match(/ /g)?.length ?? 0),
          0,
        );
        drawRuns(
          line.runs,
          x + line.indent + Math.max(0, offset),
          y,
          line.size,
          line.align === "justify" && spaces ? Math.max(0, availableWidth - length) / spaces : 0,
        );
        y += line.size * 1.35 + line.after;
      }
      y = pageHeight - margin - footerHeight;
      pdf
        .save()
        .strokeColor("#aaaaaa")
        .moveTo(x, y)
        .lineTo(x + width, y)
        .stroke()
        .restore();
      y += 6;
      for (const runLine of footerLines) {
        drawRuns(runLine, x, y, smallSize);
        y += lineHeight;
      }
      pdf
        .font("Allik-Regular")
        .fontSize(7)
        .text(`Página ${pageIndex + 1} de ${pages.length}`, x, pageHeight - margin + 4, {
          width,
          align: "right",
          lineBreak: false,
        });
    }
  });
  pdf.end();
  return result;
}
