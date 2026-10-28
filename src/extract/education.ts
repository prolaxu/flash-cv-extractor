import type {
  TextItem,
  FeatureSet,
  CvSections,
} from "../types";
import type { CvEducation } from "../types";
import { findSection } from "../layout/lookup";
import { splitIntoSubsections } from "../layout/subsections";
import {
  DATE_FEATURE_SETS,
  hasComma,
  hasLetter,
  hasNumber,
} from "../scoring/features";
import { highestScoringText } from "../scoring/score";
import {
  getBulletPoints,
  findDescriptionsLine,
} from "../text/bullets";

/**
 *              Unique Attribute
 * School       Has school
 * Degree       Has degree
 * GPA          Has number
 */

// Words that identify an institution. "Universit" is deliberately truncated so
// that it also covers Universität, Université, Universidad and Universiteit.
// prettier-ignore
const SCHOOLS = ['College', 'Universit', 'Institut', 'School', 'Academy', 'BASIS', 'Magnet', 'Polytechnic', 'Politec', 'Hochschule', 'Gymnasium', 'Seminary', 'Conservator', 'Escuela', 'Ecole', '\u00c9cole', 'Facultad', 'Faculty', 'Campus']
const hasSchool = (item: TextItem) =>
  SCHOOLS.some((school) => item.text.includes(school));
// prettier-ignore
const DEGREE_WORDS =
  /\b(?:associate|bachelor|master|doctor(?:ate)?|diplom|licence|licenciatura|ingenier|habilitation|postgraduate|undergraduate)/i;
// Abbreviated degrees, bounded so that they are not found inside other words.
// The previous test was /[ABM][A-Z.]/, which matched the "MI" of
// "Massachusetts Institute of Technology (MIT)" and so penalised the very line
// it was meant to identify as the school.
const DEGREE_ABBREVIATIONS =
  /(?:^|[^A-Za-z])(?:A\.?A|A\.?S|B\.?A|B\.?S|B\.?Sc|B\.?E|B\.?Eng|B\.?Tech|B\.?Com|M\.?A|M\.?S|M\.?Sc|M\.?E|M\.?Eng|M\.?Tech|M\.?B\.?A|M\.?P\.?H|Ph\.?D|M\.?D|J\.?D|LL\.?B|LL\.?M|Ed\.?D|D\.?D\.?S|D\.?V\.?M|B\.?C\.?A|M\.?C\.?A)(?:[^A-Za-z]|$)/;
/**
 * Strip a trailing US state code before testing for a degree.
 *
 * "Massachusetts Institute of Technology, Cambridge, MA" otherwise reads as
 * carrying an M.A., and the degree penalty then cancels the school match
 * exactly, so the institution comes back empty.
 */
const withoutStateSuffix = (text: string) =>
  text.replace(/,\s*[A-Z]{2}\b/g, "");
const hasDegree = (item: TextItem) => {
  const text = withoutStateSuffix(item.text);
  return DEGREE_WORDS.test(text) || DEGREE_ABBREVIATIONS.test(text);
};
const matchGPA = (item: TextItem) => item.text.match(/[0-4]\.\d{1,2}/);
const matchGrade = (item: TextItem) => {
  const grade = parseFloat(item.text);
  if (Number.isFinite(grade) && grade <= 110) {
    return [String(grade)] as RegExpMatchArray;
  }
  return null;
};

// Plenty of resumes put the degree, the institution and the year on one line:
// "2019 Master of Business Administration (MBA), Stanford Graduate School of
// Business". Penalties stay mild so that such a line still scores positive and
// is returned, instead of the three signals cancelling out to nothing. A line
// holding only a degree, or only a date, still scores negative and is rejected.
const SCHOOL_FEATURE_SETS: FeatureSet[] = [
  [hasSchool, 4],
  [hasDegree, -2],
  [hasNumber, -1],
];

const DEGREE_FEATURE_SETS: FeatureSet[] = [
  [hasDegree, 4],
  [hasSchool, -4],
  [hasNumber, -3],
];

const GPA_FEATURE_SETS: FeatureSet[] = [
  [matchGPA, 4, true],
  [matchGrade, 3, true],
  [hasComma, -3],
  [hasLetter, -4],
];

export const extractEducation = (sections: CvSections): CvEducation[] => {
  const education: CvEducation[] = [];
  const lines = findSection(sections, [
    "education",
    "academic credentials",
    "academic",
    "qualification",
    "schooling",
    // Vietnamese
    "trình độ học vấn",
    "học vấn",
    "giáo dục",
    "đào tạo",
  ]);
  const subsections = splitIntoSubsections(lines);
  for (const subsectionLines of subsections) {
    // Score the entry's header block only. Including its bullet points lets a
    // description line outscore the institution.
    const descriptionsLineIdx = findDescriptionsLine(subsectionLines);
    const textItems = subsectionLines
      .slice(0, descriptionsLineIdx ?? subsectionLines.length)
      .flat();
    const [school] = highestScoringText(
      textItems,
      SCHOOL_FEATURE_SETS
    );
    const [degree] = highestScoringText(
      textItems,
      DEGREE_FEATURE_SETS
    );
    const [gpa] = highestScoringText(
      textItems,
      GPA_FEATURE_SETS
    );
    const [date] = highestScoringText(
      textItems,
      DATE_FEATURE_SETS
    );

    let descriptions: string[] = [];
    if (descriptionsLineIdx !== undefined) {
      const descriptionsLines = subsectionLines.slice(descriptionsLineIdx);
      descriptions = getBulletPoints(descriptionsLines);
    }

    education.push({ school, degree, gpa, date, descriptions });
  }

  if (education.length !== 0) {
    const coursesLines = findSection(sections, ["course"]);
    if (coursesLines.length !== 0) {
      education[0].descriptions.push(
        "Courses: " +
          coursesLines
            .flat()
            .map((item) => item.text)
            .join(" ")
      );
    }
  }

  return education;
};
