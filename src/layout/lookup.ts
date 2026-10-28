import type { CvSections, Lines } from "../types";

/**
 * Fold a heading to a comparable form: lowercase, accents stripped.
 *
 * Accent folding is what lets the keyword "experience" match a heading written
 * "Expérience Professionnelle", and "zertifikate" match "Zertifikate".
 */
const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const normalize = (text: string) => fold(text).replace(/[^a-z]/g, "");

/**
 * Find the section a field should be read from.
 *
 * Keywords are given in priority order, most specific first, and that order is
 * honoured: a resume with both "Skills & Languages" and "Languages" gives the
 * dedicated section to languages. Matching runs in two passes so that an exact
 * heading always beats a partial one, whatever order the sections appear in.
 */
export const findSection = (
  sections: CvSections,
  keywords: string[]
): Lines => {
  const names = Object.keys(sections);

  // Pass 1: the heading is exactly this keyword
  for (const keyword of keywords) {
    const target = normalize(keyword);
    for (const name of names) {
      if (normalize(name) === target) return sections[name];
    }
  }

  // Pass 2: the heading contains the keyword, keywords tried in priority order.
  // Both sides are accent-folded, so "experience" finds "Expérience" and a
  // bilingual heading such as "Berufserfahrung(Professional Experience)" is
  // matched on its translation.
  for (const keyword of keywords) {
    const needle = fold(keyword);
    for (const name of names) {
      if (fold(name).includes(needle)) return sections[name];
    }
  }

  return [];
};
