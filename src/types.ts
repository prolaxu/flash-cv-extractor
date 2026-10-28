/**
 * A single run of text on a page, with where it sits and what it is set in.
 *
 * This is the contract between the pdf engine and the extraction logic. The
 * font name must be the real one (e.g. "BCDEEE+Calibri-Bold", "CMBX12"), not a
 * loaded alias, because emphasis is detected from it.
 */
export interface TextItem {
  text: string;
  /** Distance from the left edge of the page, in points. */
  x: number;
  /** Distance from the *bottom* edge of the page, in points. */
  y: number;
  width: number;
  /** Rendered font size, used to find the largest text on the page. */
  height: number;
  fontName: string;
  /** True when this item ends a visual line. */
  hasEOL: boolean;
}

export type TextItems = TextItem[];

/** Text items that share a line, left to right. */
export type Line = TextItem[];
export type Lines = Line[];

/** Lines grouped under the heading above them. */
export type CvSections = { [sectionName: string]: Lines };

/** Lines of one entry within a section, e.g. a single job. */
export type Subsections = Lines[];

// ---------------------------------------------------------------------------
// Extraction result
// ---------------------------------------------------------------------------

export interface CvProfile {
  name: string;
  email: string;
  phone: string;
  url: string;
  location: string;
  summary: string;
}

export interface CvExperience {
  company: string;
  jobTitle: string;
  date: string;
  descriptions: string[];
}

export interface CvEducation {
  school: string;
  degree: string;
  date: string;
  gpa: string;
  descriptions: string[];
}

export interface CvProject {
  name: string;
  date: string;
  descriptions: string[];
}

export interface CvSkills {
  /** Short skill labels listed above the detail lines, if the cv has any. */
  featured: string[];
  descriptions: string[];
}

export interface Cv {
  profile: CvProfile;
  experience: CvExperience[];
  education: CvEducation[];
  projects: CvProject[];
  skills: CvSkills;
  certifications: string[];
  languages: string[];
}

export type CvKey = keyof Cv;

// ---------------------------------------------------------------------------
// Feature scoring
// ---------------------------------------------------------------------------

type FeatureScore = -4 | -3 | -2 | -1 | 0 | 1 | 2 | 3 | 4;
type ReturnMatchingTextOnly = boolean;

/**
 * A test applied to a text item, and what it is worth. A set that returns a
 * regexp match can contribute just the matched substring instead of the whole
 * item, which is how an email is pulled out of a packed contact line.
 */
export type FeatureSet =
  | [(item: TextItem) => boolean, FeatureScore]
  | [
      (item: TextItem) => RegExpMatchArray | null,
      FeatureScore,
      ReturnMatchingTextOnly
    ];

export interface TextScore {
  text: string;
  score: number;
  match: boolean;
}

export type TextScores = TextScore[];
