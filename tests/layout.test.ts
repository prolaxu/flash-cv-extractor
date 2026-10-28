import { describe, it, expect } from "vitest";
import { isBold } from "../src/scoring/features";
import {
  BULLET_POINTS,
  getBulletPoints,
} from "../src/text/bullets";
import { toReadingOrder } from "../src/layout/columns";
import { groupIntoLines } from "../src/layout/lines";
import { groupIntoSections } from "../src/layout/sections";
import type { Lines, TextItems } from "../src/types";
import { item } from "./helpers";

const makeItem = item;

describe("bold detection - ", () => {
  it("detects the word bold in a font name", () => {
    expect(isBold(makeItem({ fontName: "BCDEEE+Calibri-Bold" }))).toBe(true);
    expect(isBold(makeItem({ fontName: "AAAAAA+Poppins-Bold" }))).toBe(true);
  });

  it("detects computer modern bold faces produced by latex", () => {
    // CMBX = Computer Modern Bold eXtended, which contains no "bold" at all
    expect(isBold(makeItem({ fontName: "VHRLZF+CMBX12" }))).toBe(true);
    expect(isBold(makeItem({ fontName: "YIUYBB+CMBX10" }))).toBe(true);
    expect(isBold(makeItem({ fontName: "ABCDEF+CMSSBX10" }))).toBe(true);
  });

  it("detects other bold weight names", () => {
    expect(isBold(makeItem({ fontName: "Inter-SemiBold" }))).toBe(true);
    expect(isBold(makeItem({ fontName: "Helvetica-Black" }))).toBe(true);
    expect(isBold(makeItem({ fontName: "Arial-BD" }))).toBe(true);
  });

  it("does not report regular faces as bold", () => {
    expect(isBold(makeItem({ fontName: "FZMIOL+CMR10" }))).toBe(false);
    expect(isBold(makeItem({ fontName: "TNNVYX+CMSY10" }))).toBe(false);
    expect(isBold(makeItem({ fontName: "BAAAAA+Poppins-Regular" }))).toBe(false);
    expect(isBold(makeItem({ fontName: "Calibri-Italic" }))).toBe(false);
    expect(isBold(makeItem({ fontName: "" }))).toBe(false);
  });
});

describe("bullet points - ", () => {
  it("includes the middle dot that pdfjs reports for latex bullets", () => {
    expect(BULLET_POINTS).toContain("·");
  });

  it("splits descriptions on the most common bullet, not the last seen one", () => {
    // "•" appears three times and "◦" once. The most common one is the
    // real list marker and must be the divider.
    const lines: Lines = [
      [makeItem({ text: "• first item uses ◦ inline" })],
      [makeItem({ text: "• second item" })],
      [makeItem({ text: "• third item" })],
    ];
    expect(getBulletPoints(lines)).toEqual([
      "first item uses ◦ inline",
      "second item",
      "third item",
    ]);
  });
});

describe("empty lines - ", () => {
  it("does not emit a line for a blank line in the pdf", () => {
    // A blank line in a pdf arrives as an EOL item with no text
    const textItems: TextItems = [
      makeItem({ text: "First", y: 100, hasEOL: true }),
      makeItem({ text: "", y: 90, hasEOL: true }),
      makeItem({ text: "Second", y: 80, hasEOL: true }),
    ];
    const lines = groupIntoLines(textItems);
    expect(lines).toHaveLength(2);
    expect(lines.every((line) => line.length > 0)).toBe(true);
  });
});

describe("section grouping - ", () => {
  it("merges a section title that appears more than once", () => {
    const lines: Lines = [
      [makeItem({ text: "Jane Doe", y: 200, hasEOL: true })],
      [makeItem({ text: "jane@example.com", y: 190, hasEOL: true })],
      [makeItem({ text: "EXPERIENCE", y: 180, fontName: "Calibri-Bold" })],
      [makeItem({ text: "Acme Corp", y: 170 })],
      [makeItem({ text: "EXPERIENCE", y: 160, fontName: "Calibri-Bold" })],
      [makeItem({ text: "Beta Inc", y: 150 })],
    ];
    const sections = groupIntoSections(lines);
    // The continuation must not overwrite the lines collected earlier
    expect(sections["EXPERIENCE"].flat().map((item) => item.text)).toEqual([
      "Acme Corp",
      "Beta Inc",
    ]);
  });

  it("treats an all uppercase line as a section title even when not bold", () => {
    const lines: Lines = [
      [makeItem({ text: "Jane Doe", y: 200 })],
      [makeItem({ text: "jane@example.com", y: 190 })],
      [makeItem({ text: "CERTIFICATIONS", y: 180 })],
      [makeItem({ text: "AWS Certified", y: 170 })],
    ];
    const sections = groupIntoSections(lines);
    expect(Object.keys(sections)).toContain("CERTIFICATIONS");
  });
});

describe("two column reordering - ", () => {
  const PAGE_WIDTH = 768;

  // Header spanning the full width, then a sidebar and a main column whose
  // items are emitted interleaved, which is how design templates export them.
  const buildTwoColumnPage = (): TextItems => {
    const items: TextItems = [
      makeItem({ text: "JANE DOE", x: 20, y: 1100, width: 300, height: 30 }),
      makeItem({ text: "A summary that spans the page", x: 20, y: 1080, width: 600 }),
    ];
    for (let i = 0; i < 10; i++) {
      // Interleave so neither column arrives contiguously
      items.push(
        makeItem({ text: `sidebar ${i}`, x: 24, y: 1000 - i * 20, width: 120 })
      );
      items.push(
        makeItem({ text: `main ${i}`, x: 300, y: 1000 - i * 20, width: 300 })
      );
    }
    return items;
  };

  it("emits header, then the whole left column, then the right column", () => {
    const ordered = toReadingOrder(buildTwoColumnPage(), PAGE_WIDTH);
    const texts = ordered.map((item) => item.text);

    expect(texts.slice(0, 2)).toEqual([
      "JANE DOE",
      "A summary that spans the page",
    ]);
    expect(texts.slice(2, 12)).toEqual(
      Array.from({ length: 10 }, (_, i) => `sidebar ${i}`)
    );
    expect(texts.slice(12)).toEqual(
      Array.from({ length: 10 }, (_, i) => `main ${i}`)
    );
  });

  it("marks the end of each visual line after reordering", () => {
    const ordered = toReadingOrder(buildTwoColumnPage(), PAGE_WIDTH);
    // Every item now sits alone on its line, so each one ends a line
    expect(ordered.every((item) => item.hasEOL)).toBe(true);
  });

  it("leaves a single column page untouched", () => {
    const items: TextItems = Array.from({ length: 30 }, (_, i) =>
      makeItem({
        text: `line ${i}`,
        x: 60,
        y: 700 - i * 15,
        width: 480,
        hasEOL: true,
      })
    );
    expect(toReadingOrder(items, 612)).toBe(items);
  });

  it("leaves a sparse page untouched", () => {
    // A trailing page with a handful of lines can look like two columns by
    // coincidence; too little text to trust.
    const items: TextItems = [
      makeItem({ text: "left", x: 40, y: 700, width: 100 }),
      makeItem({ text: "right", x: 450, y: 700, width: 100 }),
      makeItem({ text: "left 2", x: 40, y: 680, width: 100 }),
      makeItem({ text: "right 2", x: 450, y: 680, width: 100 }),
    ];
    expect(toReadingOrder(items, 612)).toBe(items);
  });
});
