import type { CvProject } from "../types";
import type {
  FeatureSet,
  CvSections,
} from "../types";
import { findSection } from "../layout/lookup";
import {
  DATE_FEATURE_SETS,
  getHasText,
  isBold,
} from "../scoring/features";
import { splitIntoSubsections } from "../layout/subsections";
import { highestScoringText } from "../scoring/score";
import {
  getBulletPoints,
  findDescriptionsLine,
} from "../text/bullets";

export const extractProjects = (sections: CvSections): CvProject[] => {
  const projects: CvProject[] = [];
  const lines = findSection(sections, [
    "project",
    "side quests",
    "notable open source",
    "portfolio",
    "selected work",
    // Vietnamese
    "dự án",
  ]);
  const subsections = splitIntoSubsections(lines);

  for (const subsectionLines of subsections) {
    const descriptionsLineIdx = findDescriptionsLine(subsectionLines) ?? 1;

    const subsectionInfoTextItems = subsectionLines
      .slice(0, descriptionsLineIdx)
      .flat();
    const [date] = highestScoringText(
      subsectionInfoTextItems,
      DATE_FEATURE_SETS
    );
    const PROJECT_FEATURE_SET: FeatureSet[] = [
      [isBold, 2],
      [getHasText(date), -4],
    ];
    const [project] = highestScoringText(
      subsectionInfoTextItems,
      PROJECT_FEATURE_SET,
      false
    );

    const descriptionsLines = subsectionLines.slice(descriptionsLineIdx);
    const descriptions = getBulletPoints(descriptionsLines);

    projects.push({ name: project, date, descriptions });
  }
  return projects;
};
