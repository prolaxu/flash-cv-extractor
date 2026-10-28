import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { TextItem } from "../src/types";

const here = dirname(fileURLToPath(import.meta.url));

/** The wasm engine built by `npm run build:wasm`. */
export const WASM_PATH = join(here, "..", "dist", "flash-cv-pdf-core.wasm");

/** A text item with sensible defaults, so tests only state what matters. */
export const item = (overrides: Partial<TextItem> = {}): TextItem => ({
  text: "text",
  x: 0,
  y: 0,
  width: 50,
  height: 10,
  fontName: "Calibri",
  hasEOL: false,
  ...overrides,
});

/** Build a tiny uncompressed pdf by hand, so the test needs no fixture file. */
export function buildMinimalPdf(): Uint8Array {
  const content = `BT /F1 24 Tf 72 700 Td (Hello CV) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] " +
      "/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf +=
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`;

  return new Uint8Array(Buffer.from(pdf, "latin1"));
}
