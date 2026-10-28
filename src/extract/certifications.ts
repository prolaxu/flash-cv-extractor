import type { CvSections } from "../types";
import { findSection } from "../layout/lookup";
import { getBulletPoints } from "../text/bullets";

// Only headings that genuinely name certifications. "Awards", "Honors" and
// "Achievements" are separate things in every standard cv schema, and folding
// them in here turns a "Key Achievements" section into 27 bogus certifications.
// prettier-ignore
const CERTIFICATION_KEYWORDS = [
  "certifications", "certification", "certificates", "certificate",
  "certifications and training",
  "licence", "licences", "license", "licenses", "credential", "credentials",
  // Vietnamese
  "chứng chỉ", "chứng nhạn",
];

export const extractCertifications = (sections: CvSections): string[] =>
  getBulletPoints(findSection(sections, CERTIFICATION_KEYWORDS));
