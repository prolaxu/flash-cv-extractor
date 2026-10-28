import type { CvKey } from "../types";
import type {
  Line,
  Lines,
  CvSections,
} from "../types";
import {
  hasLetterAndIsAllUpperCase,
  hasOnlyLettersSpacesAmpersands,
  isBold,
} from "../scoring/features";

export const PROFILE_SECTION: CvKey = "profile";

/**
 * Step 3. Group lines into sections
 *
 * Every section (except the profile section) starts with a section title that
 * takes up the entire line. This is a common pattern not just in resumes but
 * also in books and blogs. The resume parser uses this pattern to group lines
 * into the closest section title above these lines.
 */
/**
 * The most common text height in the document, i.e. the body text size.
 * Headings are typically set larger, which is a signal that holds regardless of
 * what the heading is called.
 */
const getBodyTextHeight = (lines: Lines): number => {
  const counts = new Map<number, number>();
  for (const line of lines) {
    for (const item of line) {
      if (!item.text.trim()) continue;
      const height = Math.round(item.height * 10) / 10;
      counts.set(height, (counts.get(height) ?? 0) + item.text.length);
    }
  }
  let bodyHeight = 0;
  let best = 0;
  for (const [height, weight] of counts) {
    if (weight > best) {
      best = weight;
      bodyHeight = height;
    }
  }
  return bodyHeight;
};

/**
 * The tallest type used by a bold line that sits alone on its line, ignoring
 * the first two lines (which carry the candidate's name and headline).
 *
 * Section headings occupy the top bold size tier of a resume. Entry headers --
 * a bold job title, a bold company -- are set below it, usually at or just
 * above body size. Comparing against this tier separates the two, where a
 * fixed multiple of the body size cannot: in one resume the headings are 12pt
 * against a 10.9pt body, in another 11.96pt against 9.5pt with entry headers
 * at 11pt in between.
 */
const getHeadingTypeHeight = (lines: Lines): number => {
  let tallest = 0;
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i];
    if (line.length !== 1) continue;
    const item = line[0];
    if (!item.text.trim() || !isBold(item)) continue;
    if (item.height > tallest) tallest = item.height;
  }
  return tallest;
};

/**
 * Group lines into sections.
 *
 * The type-size rule is powerful but double-edged: in some resumes the entry
 * headers (a bold project title, a bold job title) are set at exactly the same
 * size as the section headings and differ only in case, so applying it blindly
 * replaces "PROJECTS" with one section per project.
 *
 * So it is applied only where it *adds* headings. The strict rules run first,
 * then the size-augmented rules, and the richer result is accepted only if it
 * still contains every heading the strict pass found. A pass that loses one has
 * mistaken entry headers for sections, and is discarded.
 */
export const groupIntoSections = (lines: Lines): CvSections => {
  const strict = buildSections(lines, 0, 0);
  const augmented = buildSections(
    lines,
    getBodyTextHeight(lines),
    getHeadingTypeHeight(lines)
  );

  const augmentedNames = new Set(Object.keys(augmented));
  const keptEveryStrictHeading = Object.keys(strict).every((name) =>
    augmentedNames.has(name)
  );
  const foundMore = augmentedNames.size > Object.keys(strict).length;

  return keptEveryStrictHeading && foundMore ? augmented : strict;
};

const buildSections = (
  lines: Lines,
  bodyHeight: number,
  headingHeight: number
): CvSections => {
  let sections: CvSections = {};
  let sectionName: string = PROFILE_SECTION;
  let sectionLines: Lines = [];

  // A resume can repeat a section title (e.g. "EXPERIENCE" continued on page 2),
  // so append rather than overwrite to avoid dropping the earlier lines.
  const commitSection = () => {
    if (sectionLines.length === 0) return;
    sections[sectionName] = [
      ...(sections[sectionName] ?? []),
      ...sectionLines,
    ];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const text = line[0]?.text.trim();
    if (text && isSectionTitle(line, i, bodyHeight, headingHeight)) {
      commitSection();
      sectionName = text;
      sectionLines = [];
    } else {
      sectionLines.push(line);
    }
  }
  commitSection();
  return sections;
};

const SECTION_TITLE_PRIMARY_KEYWORDS = [
  "experience",
  "education",
  "project",
  "skill",
];
const SECTION_TITLE_SECONDARY_KEYWORDS = [
  "job",
  "course",
  "extracurricular",
  "objective",
  "summary", // LinkedIn generated resume has a summary section
  "award",
  "honor",
  "project",
  // Sections commonly found on real-world resumes. Only words that head a
  // section in their own right belong here: a word like "language" or
  // "technology" also appears as a sub-label inside a skills section
  // ("Languages & Frameworks"), which would split the section in two.
  "employment",
  "certification",
  "certificate",
  "licence",
  "license",
  "publication",
  "volunteer",
  "achievement",
  "accomplishment",
  "competenc", // "Core Competencies"
  "qualification",
  "reference",
];
const SECTION_TITLE_KEYWORDS = [
  ...SECTION_TITLE_PRIMARY_KEYWORDS,
  ...SECTION_TITLE_SECONDARY_KEYWORDS,
];

/** No real section heading runs longer than this. */
const MAX_SECTION_TITLE_WORDS = 5;

/**
 * Characters a heading may contain, e.g. "Where I've Worked", "R&D / Labs",
 * "Persönliche Daten", "Berufserfahrung(Professional Experience)".
 *
 * Accented letters and a parenthesised translation have to be allowed: a
 * bilingual resume labels its sections in both languages, and rejecting those
 * characters threw away every heading in one, costing it its entire work
 * history. Digits stay excluded, which is what keeps body text out.
 */
const HEADING_CHARS = /^[\p{L}][\p{L}\s&'\u2019\-/().,]*$/u;

const isSectionTitle = (
  line: Line,
  lineNumber: number,
  bodyHeight = 0,
  headingHeight = 0
) => {
  const isFirstTwoLines = lineNumber < 2;
  const hasMoreThanOneItemInLine = line.length > 1;
  const hasNoItemInLine = line.length === 0;
  if (isFirstTwoLines || hasMoreThanOneItemInLine || hasNoItemInLine) {
    return false;
  }

  const textItem = line[0];

  const text = textItem.text.trim();
  const wordCount = text.split(/\s+/).filter((s) => s !== "&").length;

  // A section title is short. Without this bound, a bold uppercase banner such
  // as "PHP LARAVEL MYSQL POSTGRESQL REST APIS JAVASCRIPT DOCKER GIT" is read
  // as a section title and swallows the rest of the resume.
  if (wordCount > MAX_SECTION_TITLE_WORDS) {
    return false;
  }

  // The main heuristic to determine a section title is to check if the text is double emphasized
  // to be both bold and all uppercase, which is generally true for a well formatted resume
  if (isBold(textItem) && hasLetterAndIsAllUpperCase(textItem)) {
    return true;
  }

  const startsWithCapitalLetter = /[A-Z]/.test(text.slice(0, 1));
  const hasKeyword = SECTION_TITLE_KEYWORDS.some((keyword) =>
    text.toLowerCase().includes(keyword)
  );

  // Some resume templates render section titles in all uppercase without bolding
  // them (common in two column and designer templates). An all uppercase line of
  // a few words that is nothing but letters is a section title in practice.
  if (
    hasLetterAndIsAllUpperCase(textItem) &&
    hasOnlyLettersSpacesAmpersands(textItem) &&
    wordCount <= 4
  ) {
    return true;
  }

  // A short bold line in the resume's top heading size tier, set larger than
  // the body, is a heading whatever it is called. This catches the many
  // resumes that title their sections "Career Journey" or "Professional
  // Philosophy", which no keyword list can anticipate.
  if (
    isBold(textItem) &&
    headingHeight > 0 &&
    bodyHeight > 0 &&
    textItem.height >= headingHeight * 0.98 &&
    textItem.height > bodyHeight * 1.02 &&
    HEADING_CHARS.test(text)
  ) {
    return true;
  }

  // The following is a fallback heuristic to detect section title if it includes a keyword match
  // (This heuristics is not well tested and may not work well)
  if (
    wordCount <= 2 &&
    hasOnlyLettersSpacesAmpersands(textItem) &&
    startsWithCapitalLetter &&
    hasKeyword
  ) {
    return true;
  }

  return false;
};
