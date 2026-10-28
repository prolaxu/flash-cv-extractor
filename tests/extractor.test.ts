import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { FlashCvExtractor } from "../src/extractor";
import { WASM_PATH, buildMinimalPdf, item } from "./helpers";

/** Two items that need no pdf: a name and an email in the top block. */
const fakeEngine = async () => [
  item({
    text: "Jane Doe",
    width: 90,
    height: 22,
    fontName: "Helvetica-Bold",
    hasEOL: true,
  }),
  item({ text: "jane@example.com", width: 100, hasEOL: true }),
];

describe("FlashCvExtractor", () => {
  it("reads a cv through an engine supplied by the caller", async () => {
    const extractor = new FlashCvExtractor(fakeEngine);
    const cv = await extractor.extract(new Uint8Array());

    expect(cv.profile.name).toBe("Jane Doe");
    expect(cv.profile.email).toBe("jane@example.com");
  });

  it("analyse returns all four stages", async () => {
    const extractor = new FlashCvExtractor(fakeEngine);
    const { items, lines, sections, cv } = await extractor.analyse(
      new Uint8Array()
    );

    expect(items).toHaveLength(2);
    expect(lines).toHaveLength(2);
    expect(Object.keys(sections)).toContain("profile");
    expect(cv.profile.name).toBe("Jane Doe");
  });

});

describe.skipIf(!existsSync(WASM_PATH))("FlashCvExtractor with wasm - ", () => {
  it("rejects a file that is not a pdf", async () => {
    const extractor = new FlashCvExtractor(WASM_PATH);
    await expect(
      extractor.extract(new Uint8Array([1, 2, 3, 4]))
    ).rejects.toThrow(/flash-cv-extractor/);
  });

  it("extracts a pdf with no engine wiring", async () => {
    const extractor = new FlashCvExtractor(WASM_PATH);
    const cv = await extractor.extract(buildMinimalPdf());

    expect(Array.isArray(cv.experience)).toBe(true);
    expect(Array.isArray(cv.education)).toBe(true);
  });

  it("analyse reads every stage from a real pdf", async () => {
    const extractor = new FlashCvExtractor(WASM_PATH);
    const { items, lines, cv } = await extractor.analyse(buildMinimalPdf());

    expect(items.length).toBeGreaterThan(0);
    expect(lines.length).toBeGreaterThan(0);
    expect(cv.profile).toBeDefined();
  });
});
