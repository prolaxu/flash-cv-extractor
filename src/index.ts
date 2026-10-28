/**
 * flash-cv-extractor
 *
 * Extract structured data from a cv/resume pdf, using a Rust pdf engine
 * compiled to WebAssembly.
 *
 * @example
 * import { extractCv, createWasmEngine } from "flash-cv-extractor";
 *
 * const engine = createWasmEngine("/flash-cv-pdf-core.wasm");
 * const cv = await extractCv(pdfBytes, { engine });
 * console.log(cv.profile.name, cv.experience.length);
 */

// Main entry points
export { extractCv, extractCvFromItems, toSections, toLines } from "./pipeline";
export type { ExtractOptions } from "./pipeline";

// Engine
export { createWasmEngine } from "./engine/wasm";
export type { WasmSource } from "./engine/wasm";
export type { PdfEngine, PdfSource } from "./engine/types";

// Pipeline steps, for reuse or inspection
export { groupIntoLines } from "./layout/lines";
export { groupIntoSections } from "./layout/sections";
export { toReadingOrder } from "./layout/columns";
export { splitIntoSubsections } from "./layout/subsections";
export { findSection } from "./layout/lookup";
export { extractCvFromSections } from "./extract";

// Result types
export type {
  Cv,
  CvProfile,
  CvExperience,
  CvEducation,
  CvProject,
  CvSkills,
  CvSections,
  CvKey,
  TextItem,
  TextItems,
  Line,
  Lines,
  Subsections,
} from "./types";
