import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { createWasmEngine } from "../src/engine/wasm";
import { extractCvFromItems } from "../src/pipeline";
import { WASM_PATH, buildMinimalPdf } from "./helpers";

const hasWasm = existsSync(WASM_PATH);

// The engine is a build artifact; skip rather than fail when it is absent
describe.skipIf(!hasWasm)("wasm engine - ", () => {
  const engine = createWasmEngine(WASM_PATH);

  it("loads with no javascript imports", async () => {
    const wasmModule = await WebAssembly.compile(readFileSync(WASM_PATH));
    // A standalone module: nothing to supply, so it can be served from a CDN
    expect(WebAssembly.Module.imports(wasmModule)).toEqual([]);
  });

  it("exports the expected c abi", async () => {
    const wasmModule = await WebAssembly.compile(readFileSync(WASM_PATH));
    const names = WebAssembly.Module.exports(wasmModule).map((e) => e.name);
    for (const name of ["memory", "alloc", "dealloc", "extract", "result_len"]) {
      expect(names).toContain(name);
    }
  });

  it("reports a readable error for a file that is not a pdf", async () => {
    await expect(engine(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow(
      /flash-cv-extractor/
    );
  });

  it("produces items carrying real font names", async () => {
    // A minimal pdf with one Helvetica text run
    const pdf = buildMinimalPdf();
    const items = await engine(pdf);
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].text).toBe("Hello CV");
    expect(items[0].fontName).toBe("Helvetica");
    expect(items[0].height).toBeCloseTo(24, 0);
    expect(items[0].x).toBeCloseTo(72, 0);
    expect(items[0].y).toBeCloseTo(700, 0);
  });

  it("runs the whole pipeline over engine output", async () => {
    const items = await engine(buildMinimalPdf());
    const cv = extractCvFromItems(items);
    expect(cv.profile).toBeDefined();
    expect(Array.isArray(cv.experience)).toBe(true);
  });
});

