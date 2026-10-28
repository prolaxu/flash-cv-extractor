import type { Cv, CvSections, Lines, TextItems } from "./types";
import type { PdfEngine, PdfSource } from "./engine/types";
import { createWasmEngine } from "./engine/wasm";
import type { WasmSource } from "./engine/wasm";
import { extractCvFromSections } from "./extract";
import { groupIntoLines } from "./layout/lines";
import { groupIntoSections } from "./layout/sections";
import { extractCv } from "./pipeline";

/** Every stage of the pipeline, for inspecting a document that came out wrong. */
export interface CvAnalysis {
  items: TextItems;
  lines: Lines;
  sections: CvSections;
  cv: Cv;
}

/** Every wasm source is a value; an engine is the only callable option. */
const isEngine = (source: WasmSource | PdfEngine): source is PdfEngine =>
  typeof source === "function";

/**
 * Reads a cv out of a pdf.
 *
 * The wasm engine is created, compiled and cached internally, so reading a cv
 * takes one constructor argument and one call:
 *
 * @example
 * const extractor = new FlashCvExtractor("/flash-cv-pdf-core.wasm");
 * const cv = await extractor.extract(pdfBytes);
 *
 * @example
 * // Bring your own engine; anything returning positioned text items works.
 * const extractor = new FlashCvExtractor(myEngine);
 */
export class FlashCvExtractor {
  private readonly engine: PdfEngine;

  /**
   * @param source Where to load the wasm engine from -- a url, a filesystem
   * path, the bytes themselves -- or a `PdfEngine` of your own.
   */
  constructor(source: WasmSource | PdfEngine) {
    this.engine = isEngine(source) ? source : createWasmEngine(source);
  }

  /** Read a pdf and return the extracted cv. */
  extract(source: PdfSource): Promise<Cv> {
    return extractCv(source, { engine: this.engine });
  }

  /**
   * Read a pdf once and return every stage: the text items, the lines, the
   * sections they were filed under, and the cv picked out of them. Useful when
   * a field came back wrong and you need to see how the document was divided.
   *
   * @example
   * const { sections } = await extractor.analyse(pdfBytes);
   * console.log(Object.keys(sections));
   */
  async analyse(source: PdfSource): Promise<CvAnalysis> {
    const items = await this.engine(source);
    const lines = groupIntoLines(items);
    const sections = groupIntoSections(lines);
    return { items, lines, sections, cv: extractCvFromSections(sections) };
  }
}
