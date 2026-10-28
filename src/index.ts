/**
 * flash-cv-extractor
 *
 * Extract structured data from a cv/resume pdf, using a Rust pdf engine
 * compiled to WebAssembly.
 *
 * @example
 * import { FlashCvExtractor } from "flash-cv-extractor";
 *
 * const extractor = new FlashCvExtractor("/flash-cv-pdf-core.wasm");
 * const cv = await extractor.extract(pdfBytes);
 * console.log(cv.profile.name, cv.experience.length);
 */

// High level api
export { FlashCvExtractor } from "./extractor";
export type { CvAnalysis } from "./extractor";

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
