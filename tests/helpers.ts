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
