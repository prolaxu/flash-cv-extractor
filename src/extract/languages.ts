import type { CvSections } from "../types";
import { findSection } from "../layout/lookup";
import { getBulletPoints } from "../text/bullets";

// prettier-ignore
const LANGUAGE_KEYWORDS = [
  "languages", "language", "mother tongue",
  // Vietnamese
  "ngoại ngứ", "ngôn ngứ",
];

export const extractLanguages = (sections: CvSections): string[] =>
  getBulletPoints(findSection(sections, LANGUAGE_KEYWORDS));
