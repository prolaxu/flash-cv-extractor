import type { Cv, CvSections, Lines, TextItems } from "./types";
import type { PdfEngine, PdfSource } from "./engine/types";
import { groupIntoLines } from "./layout/lines";
import { groupIntoSections } from "./layout/sections";
import { extractCvFromSections } from "./extract";

export interface ExtractOptions {
  /** The pdf engine to read the document with. */
  engine: PdfEngine;
}

/**
 * Read a cv out of a pdf.
 *
 * Four steps, each usable on its own:
 *   1. the engine turns the pdf into positioned text items
 *   2. items are grouped into lines
 *   3. lines are grouped under the heading above them
 *   4. each field is picked from its section by feature scoring
 */
export const extractCv = async (
  source: PdfSource,
  options: ExtractOptions
): Promise<Cv> => {
  const textItems = await options.engine(source);
  return extractCvFromItems(textItems);
};

/** Steps 2 to 4, for text items you already have. */
export const extractCvFromItems = (textItems: TextItems): Cv =>
  extractCvFromSections(toSections(textItems));

/** Steps 2 and 3, exposed for inspecting how a document was divided up. */
export const toSections = (textItems: TextItems): CvSections =>
  groupIntoSections(toLines(textItems));

/** Step 2 only. */
export const toLines = (textItems: TextItems): Lines =>
  groupIntoLines(textItems);
