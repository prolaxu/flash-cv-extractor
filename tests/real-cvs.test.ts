import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createWasmEngine } from "../src/engine/wasm";
import { extractCv } from "../src/pipeline";
import { WASM_PATH } from "./helpers";

/**
 * Smoke test over a directory of real cvs, if one is available locally. Real
 * cvs are personal data, so none are committed; point FLASH_CV_FIXTURES at a
 * folder of pdfs to run this.
 */
const fixtures = process.env.FLASH_CV_FIXTURES;
const canRun =
  existsSync(WASM_PATH) && Boolean(fixtures) && existsSync(fixtures!);

describe.skipIf(!canRun)("real cvs - ", () => {
  const engine = createWasmEngine(WASM_PATH);
  const files = canRun
    ? readdirSync(fixtures!).filter((f) => f.toLowerCase().endsWith(".pdf"))
    : [];

  it("finds at least one pdf to test", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("extracts a usable cv from %s", async (file) => {
    const bytes = new Uint8Array(readFileSync(join(fixtures!, file)));
    const cv = await extractCv(bytes, { engine });

    // A cv without a name or a way to make contact is a failed extraction
    expect(cv.profile.name.length).toBeGreaterThan(0);
    expect(cv.profile.email || cv.profile.phone).toBeTruthy();

    // The name should look like a name, not a skill badge or a heading
    expect(cv.profile.name).not.toMatch(/[@/]|\d/);

    // An email, if found, must be a single clean address
    if (cv.profile.email) {
      expect(cv.profile.email).toMatch(/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i);
    }

    // Sections should be present and not absurd
    expect(cv.experience.length + cv.projects.length).toBeGreaterThan(0);
    expect(cv.skills.descriptions.length).toBeGreaterThan(0);
  });
});
