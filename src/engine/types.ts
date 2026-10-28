import type { TextItems } from "../types";

/** Anything a pdf can be handed over as. */
export type PdfSource = string | URL | ArrayBuffer | Uint8Array;

/**
 * Turns a pdf into positioned text items.
 *
 * This is the seam between the pdf engine and the extraction logic: swap the
 * engine and the rest of the pipeline is untouched. The items must be in
 * reading order, and each must carry the real font name.
 */
export type PdfEngine = (source: PdfSource) => Promise<TextItems>;
