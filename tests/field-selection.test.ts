import { describe, it, expect } from "vitest";
import { extractCvFromSections } from "../src/extract";
import type { CvSections, Lines } from "../src/types";
import { item } from "./helpers";

/** Build a section's lines, going down the page. */
const lines = (
  rows: { text: string; bold?: boolean; gap?: number }[]
): Lines => {
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

const sectionsWith = (name: string, rows: Parameters<typeof lines>[0]) =>
  ({ profile: [], [name]: lines(rows) } as unknown as CvSections);

describe("company selection - ", () => {
  it("prefers the employer over the employment type", () => {
    const cv = extractCvFromSections(
      sectionsWith("EXPERIENCE", [
        { text: "Growth Hacker / Founding Engineer", bold: true },
        { text: "Agile Dynamics" },
        { text: "Full-time" },
        { text: "• Built the growth funnel" },
      ])
    );
    expect(cv.experience[0].company).toBe("Agile Dynamics");
  });

  it("ignores a bare field label", () => {
    const cv = extractCvFromSections(
      sectionsWith("EXPERIENCE", [
        { text: "Employer" },
        { text: "Zenith Corp" },
        { text: "• Delivered the platform" },
      ])
    );
    expect(cv.experience[0].company).toBe("Zenith Corp");
  });

  it("ignores a footnote marker", () => {
    const cv = extractCvFromSections(
      sectionsWith("EXPERIENCE", [
        { text: "1" },
        { text: "Stanford University, Department of CS" },
        { text: "• Taught distributed systems" },
      ])
    );
    expect(cv.experience[0].company).toContain("Stanford University");
  });
});

describe("school selection - ", () => {
  it("is not blocked by a graduation year on the same line", () => {
    const cv = extractCvFromSections(
      sectionsWith("EDUCATION", [
        { text: "B.S. Computer Science 2009-2013", bold: true },
        { text: "State University of New York 2013" },
      ])
    );
    expect(cv.education[0].school).toContain("State University of New York");
  });

  it("does not read a us state code as a degree", () => {
    // ", MA" must not register as an M.A., which would cancel the school match
    const cv = extractCvFromSections(
      sectionsWith("EDUCATION", [
        { text: "M.S. Computer Science", bold: true },
        { text: "Massachusetts Institute of Technology, Cambridge, MA" },
      ])
    );
    expect(cv.education[0].school).toContain("Massachusetts Institute");
  });

  it("recognises an institution named in another language", () => {
    const cv = extractCvFromSections(
      sectionsWith("EDUCATION", [
        { text: "Diplom Informatik", bold: true },
        { text: "Technische Universitat Munchen" },
      ])
    );
    expect(cv.education[0].school).toContain("Universitat");
  });
});

describe("certifications - ", () => {
  it("does not treat an achievements section as certifications", () => {
    const cv = extractCvFromSections(
      sectionsWith("Key Achievements", [
        { text: "• Grew revenue by 40%" },
        { text: "• Shipped the platform rewrite" },
      ])
    );
    expect(cv.certifications).toEqual([]);
  });

  it("reads a real certifications section", () => {
    const cv = extractCvFromSections(
      sectionsWith("Certifications", [
        { text: "• AWS Certified Developer" },
        { text: "• Certified Kubernetes Administrator" },
      ])
    );
    expect(cv.certifications).toHaveLength(2);
    expect(cv.certifications[0]).toContain("AWS Certified Developer");
  });
});
