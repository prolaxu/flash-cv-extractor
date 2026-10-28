import type { CvSections, CvSkills } from "../types";
import { findSection } from "../layout/lookup";
import { getBulletPoints, findDescriptionsLine } from "../text/bullets";

/** How many leading labels are treated as featured skills. */
const MAX_FEATURED_SKILLS = 6;

export const extractSkills = (sections: CvSections): CvSkills => {
  const lines = findSection(sections, [
    "technical skills",
    "core competencies",
    "skill",
    "competenc",
    "technical acumen",
    "expertise",
    // Vietnamese
    "kỹ năng",
  ]);
  const descriptionsLineIdx = findDescriptionsLine(lines) ?? 0;
  const descriptions = getBulletPoints(lines.slice(descriptionsLineIdx));

  // Anything above the detail lines is a short label, e.g. a skill badge row
  const featured =
    descriptionsLineIdx === 0
      ? []
      : lines
          .slice(0, descriptionsLineIdx)
          .flat()
          .map((item) => item.text.trim())
          .filter(Boolean)
          .slice(0, MAX_FEATURED_SKILLS);

  return { featured, descriptions };
};
