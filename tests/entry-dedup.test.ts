import { describe, it, expect } from "vitest";
import { extractCvFromSections } from "../src/extract";
import type { CvSections, Lines } from "../src/types";
import { item } from "./helpers";

const lines = (rows: { text: string; bold?: boolean; gap?: number }[]): Lines => {
  let y = 600;
  return rows.map((row) => {
    y -= row.gap ?? 14;
    return [
      item({
        text: row.text,
        y,
        fontName: row.bold ? "Calibri-Bold" : "Calibri",
      }),
    ];
  });
};
const section = (name: string, rows: Parameters<typeof lines>[0]) =>
  ({ profile: [], [name]: lines(rows) } as unknown as CvSections);

describe("entry de-duplication - ", () => {
  it("rejoins one job that was split into two entries", () => {
    // Same employer, title and date on both halves: one job, split, with its
    // bullets divided between them.
    const cv = extractCvFromSections(
      section("EXPERIENCE", [
        { text: "Staff Accountant", bold: true },
        { text: "Acme Corp 2019 - 2021", bold: true },
        { text: "• Reconciled monthly accounts" },
        { text: "Staff Accountant", bold: true, gap: 40 },
        { text: "Acme Corp 2019 - 2021", bold: true },
        { text: "• Prepared quarterly filings" },
      ])
    );
    expect(cv.experience).toHaveLength(1);
    // and keeps the bullets from both halves
    expect(cv.experience[0].descriptions).toHaveLength(2);
  });

  it("keeps separate stints at the same employer apart", () => {
    // The dates differ, so these are two real jobs
    const cv = extractCvFromSections(
      section("EXPERIENCE", [
        { text: "Principal Engineer", bold: true },
        { text: "TechNova Inc. 2023 - Present", bold: true },
        { text: "• Led the platform team" },
        { text: "Senior Engineer", bold: true, gap: 40 },
        { text: "TechNova Inc. 2019 - 2021", bold: true },
        { text: "• Built the billing service" },
      ])
    );
    expect(cv.experience).toHaveLength(2);
  });

  it("drops an entry that carries nothing", () => {
    const cv = extractCvFromSections(
      section("EXPERIENCE", [
        { text: "Acme Corp 2019 - 2021", bold: true },
        { text: "• Reconciled monthly accounts" },
        { text: "·" , gap: 40 },
      ])
    );
    expect(cv.experience.every((e) => e.company || e.jobTitle || e.date || e.descriptions.length)).toBe(true);
  });
});

describe("name selection - ", () => {
  it("does not report a section heading as the name", () => {
    // A redacted resume leaves the job-title banner as the largest bold text
    const sections = {
      profile: lines([{ text: "PROJECT ACCOUNTANT", bold: true }]),
      "PROJECT ACCOUNTANT": lines([{ text: "Summary of experience" }]),
    } as unknown as CvSections;
    expect(extractCvFromSections(sections).profile.name).toBe("");
  });
});
