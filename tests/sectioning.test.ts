import { describe, it, expect } from "vitest";
import { groupIntoSections } from "../src/layout/sections";
import { splitIntoSubsections } from "../src/layout/subsections";
import { findSection } from "../src/layout/lookup";
import type { Lines } from "../src/types";
import { item } from "./helpers";

/** Build lines going down the page, one item each. */
const page = (
  rows: { text: string; bold?: boolean; height?: number; gap?: number }[]
): Lines => {
  let y = 700;
  return rows.map((row) => {
    y -= row.gap ?? 14;
    return [
      item({
        text: row.text,
        y,
        height: row.height ?? 10,
        fontName: row.bold ? "Calibri-Bold" : "Calibri",
      }),
    ];
  });
};

describe("subsection splitting - ", () => {
  it("does not start a new entry on a bullet line", () => {
    // The gap before the first bullet is wide enough to look like a boundary.
    // Treating it as one splits a single job into two.
    const lines = page([
      { text: "Principal Engineer", bold: true },
      { text: "TechNova Inc. January 2023 - Present", bold: true, gap: 15 },
      { text: "San Francisco, CA", gap: 13 },
      { text: "• Led a team of 8 engineers", gap: 22 },
      { text: "• Architected multi-region deployment", gap: 15 },
      { text: "Staff Engineer", bold: true, gap: 30 },
      { text: "Momentum Solutions March 2022 - December 2022", bold: true, gap: 15 },
      { text: "• Designed event-driven microservices", gap: 22 },
    ]);
    // Two jobs, not four
    expect(splitIntoSubsections(lines)).toHaveLength(2);
  });
});

describe("heading detection - ", () => {
  it("finds a bold title-cased heading set in larger type", () => {
    // No keyword and no uppercase to go on: only the type size says "heading"
    const lines = page([
      { text: "Ruby Chen", bold: true, height: 17 },
      { text: "ruby.chen@email.com" },
      { text: "Career Journey", bold: true, height: 12 },
      { text: "Senior Software Engineer February 2022 - Present", bold: true },
      { text: "Python Solutions Inc." },
      { text: "Professional Philosophy", bold: true, height: 12 },
      { text: "I have built distributed systems in Go and Ruby." },
    ]);
    const sections = groupIntoSections(lines);
    expect(Object.keys(sections)).toContain("Career Journey");
    expect(Object.keys(sections)).toContain("Professional Philosophy");
  });

  it("does not turn entry headers into sections", () => {
    // Here the project titles are bold at the same size as the real heading and
    // differ only in case. Promoting them would destroy "PROJECTS".
    const lines = page([
      { text: "NABIN DUWADI", bold: true, height: 18 },
      { text: "nabin@example.com" },
      { text: "PROJECTS", bold: true, height: 11 },
      { text: "Personal Portfolio Website", bold: true, height: 11 },
      { text: "• Built a responsive portfolio site" },
      { text: "Secure Web Application", bold: true, height: 11 },
      { text: "• Developed a full-stack application" },
    ]);
    const sections = groupIntoSections(lines);
    expect(Object.keys(sections)).toContain("PROJECTS");
    expect(Object.keys(sections)).not.toContain("Personal Portfolio Website");
    // Both projects stay inside the one section
    expect(sections["PROJECTS"].length).toBe(4);
  });

  it("keeps an uppercase heading above its entry headers", () => {
    const lines = page([
      { text: "NABIN ACHARYA", bold: true, height: 39 },
      { text: "BACKEND DEVELOPER", bold: true, height: 17 },
      { text: "EXPERIENCE", bold: true, height: 12 },
      { text: "Junior Backend Developer", bold: true, height: 11 },
      { text: "Virtuals Aura Pvt. Ltd." },
      { text: "Backend Developer Intern", bold: true, height: 11 },
      { text: "COL Thinkspace" },
    ]);
    const sections = groupIntoSections(lines);
    expect(Object.keys(sections)).toContain("EXPERIENCE");
    expect(Object.keys(sections)).not.toContain("Junior Backend Developer");
  });
});

describe("section lookup - ", () => {
  const sections = {
    profile: [] as never[],
    "Skills & Languages": page([{ text: "English, French" }]),
    Languages: page([{ text: "Nepali - Native" }]),
    "Career Journey": page([{ text: "Senior Engineer" }]),
  };

  it("prefers an exact heading over a partial one", () => {
    // "Skills & Languages" also contains "language", but the dedicated
    // section must win
    const found = findSection(sections, ["languages", "language"]);
    expect(found[0][0].text).toBe("Nepali - Native");
  });

  it("honours keyword priority order", () => {
    const found = findSection(sections, ["skill", "language"]);
    expect(found[0][0].text).toBe("English, French");
  });

  it("maps a non-standard heading to the right field", () => {
    const found = findSection(sections, ["work experience", "career"]);
    expect(found[0][0].text).toBe("Senior Engineer");
  });

  it("returns nothing when no heading matches", () => {
    expect(findSection(sections, ["publications"])).toEqual([]);
  });
});

describe("non-english headings - ", () => {
  it("detects a bilingual heading carrying a translation in parentheses", () => {
    // A german resume labels its sections in both languages. Rejecting the
    // parentheses, or the umlaut, threw away every heading in the document.
    const lines = page([
      { text: "Klaus M\u00fcller", bold: true, height: 17 },
      { text: "klaus@example.de" },
      { text: "Pers\u00f6nliche Daten(Personal Data)", bold: true, height: 12 },
      { text: "Berufserfahrung(Professional Experience)", bold: true, height: 12 },
      { text: "SAP SE, Walldorf - Senior Enterprise Architect, 2019 to present" },
      { text: "Designed the integration layer for a multi-region deployment" },
      { text: "Led a team of eight engineers across three countries" },
      { text: "Ausbildung(Education)", bold: true, height: 12 },
      { text: "Technische Universit\u00e4t M\u00fcnchen" },
      { text: "Diplom Informatik, awarded with distinction in 2012" },
    ]);
    const names = Object.keys(groupIntoSections(lines));
    expect(names).toContain("Berufserfahrung(Professional Experience)");
    expect(names).toContain("Ausbildung(Education)");
  });

  it("matches a keyword across accents", () => {
    const sections = {
      profile: [] as never[],
      "Exp\u00e9rience Professionnelle": page([{ text: "Sony Interactive" }]),
      "Zertifikate(Certifications)": page([{ text: "AWS Certified" }]),
    };
    // "experience" has to find "Expérience"
    expect(findSection(sections, ["experience"])[0][0].text).toBe(
      "Sony Interactive"
    );
    // and a bilingual heading is matched on its translation
    expect(findSection(sections, ["certifications"])[0][0].text).toBe(
      "AWS Certified"
    );
  });

  it("still keeps digits out of headings", () => {
    const lines = page([
      { text: "Jane Doe", bold: true, height: 17 },
      { text: "jane@example.com" },
      { text: "Reduced costs by 40% in 2023", bold: true, height: 12 },
    ]);
    expect(Object.keys(groupIntoSections(lines))).not.toContain(
      "Reduced costs by 40% in 2023"
    );
  });
});
