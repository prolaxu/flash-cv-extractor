import { describe, it, expect } from "vitest";
import { extractCvFromSections } from "../src/extract";
import type { CvSections, Lines } from "../src/types";
import { item } from "./helpers";

const lines = (rows: { text: string; bold?: boolean; gap?: number }[]): Lines => {
  let y = 600;
  return rows.map((row) => {
    y -= row.gap ?? 14;
    return [item({ text: row.text, y, fontName: row.bold ? "Calibri-Bold" : "Calibri" })];
  });
};
const section = (name: string, rows: Parameters<typeof lines>[0]) =>
  ({ profile: [], [name]: lines(rows) } as unknown as CvSections);

describe("company and its dates on one line - ", () => {
  it("keeps the employer and drops the date", () => {
    const cv = extractCvFromSections(
      section("EXPERIENCE", [
        { text: "Pricing Operations Manager", bold: true },
        { text: "Daraz February 2023 - Now", bold: true },
        { text: "• Ran the pricing desk" },
      ])
    );
    expect(cv.experience[0].company).toBe("Daraz");
    expect(cv.experience[0].date).toContain("2023");
  });

  it("returns nothing rather than a bare date", () => {
    const cv = extractCvFromSections(
      section("EXPERIENCE", [
        { text: "Administration Manager", bold: true },
        { text: "February, 2023 - January, 2024", bold: true },
        { text: "• Managed the office" },
      ])
    );
    // A date is not an employer; empty is the honest answer
    expect(cv.experience[0].company).toBe("");
  });

  it("does not strip 'now' when it is part of the name", () => {
    // "Momentum Solutions (now Apex Systems)" carries no date, so "now" stays
    const cv = extractCvFromSections(
      section("EXPERIENCE", [
        { text: "Staff Engineer", bold: true },
        { text: "Momentum Solutions (now Apex Systems)", bold: true },
        { text: "• Designed the migration" },
      ])
    );
    expect(cv.experience[0].company).toContain("now Apex Systems");
  });

  it("does not strip words that merely begin like a month", () => {
    // /mar[a-z]*/ would eat "Marketing"; /jun[a-z]*/ would eat "Junior"
    const cv = extractCvFromSections(
      section("EXPERIENCE", [
        { text: "Analyst", bold: true },
        { text: "Marchés Marketing Junior Group Ltd", bold: true },
        { text: "• Built the reporting stack" },
      ])
    );
    expect(cv.experience[0].company).toContain("Marketing");
    expect(cv.experience[0].company).toContain("Junior");
  });
});
