import type { CvExperience } from "../types";
import type {
  TextItem,
  FeatureSet,
  CvSections,
} from "../types";
import { findSection } from "../layout/lookup";
import {
  DATE_FEATURE_SETS,
  hasNumber,
  getHasText,
  isBold,
} from "../scoring/features";
import { splitIntoSubsections } from "../layout/subsections";
import { highestScoringText } from "../scoring/score";
import {
  getBulletPoints,
  findDescriptionsLine,
} from "../text/bullets";

// Headings that introduce work history, most specific first so that priority
// order is meaningful. Resumes title this section anything from "Employment
// History" to "Career Journey".
// prettier-ignore
const WORK_EXPERIENCE_KEYWORDS_LOWERCASE = [
  'work experience', 'professional experience', 'employment history',
  'work history', 'career journey', 'professional journey',
  'experience', 'employment', 'career', 'job',
  // Vietnamese
  'kinh nghiệm làm việc', 'kinh nghiệm',
];
// prettier-ignore
const JOB_TITLES = ['Accountant', 'Administrator', 'Advisor', 'Agent', 'Analyst', 'Apprentice', 'Architect', 'Assistant', 'Associate', 'Auditor', 'Bartender', 'Biologist', 'Bookkeeper', 'Buyer', 'Carpenter', 'Cashier', 'CEO', 'Clerk', 'Co-op', 'Co-Founder', 'Consultant', 'Coordinator', 'CTO', 'Developer', 'Designer', 'Director', 'Driver', 'Editor', 'Electrician', 'Engineer', 'Extern', 'Founder', 'Freelancer', 'Head', 'Intern', 'Janitor', 'Journalist', 'Laborer', 'Lawyer', 'Lead', 'Manager', 'Mechanic', 'Member', 'Nurse', 'Officer', 'Operator', 'Operation', 'Photographer', 'President', 'Producer', 'Recruiter', 'Representative', 'Researcher', 'Sales', 'Server', 'Scientist', 'Specialist', 'Supervisor', 'Teacher', 'Technician', 'Trader', 'Trainee', 'Treasurer', 'Tutor', 'Vice', 'VP', 'Volunteer', 'Webmaster', 'Worker', 'Advocate', 'Ambassador', 'Attorney', 'Chief', 'Counsel', 'Educator', 'Evangelist', 'Executive', 'Fellow', 'Instructor', 'Officer', 'Owner', 'Partner', 'Physician', 'Pilot', 'Practitioner', 'Principal', 'Staff', 'Strategist', 'Surgeon', 'Technologist', 'Therapist', 'Trainer'];

const hasJobTitle = (item: TextItem) =>
  JOB_TITLES.some((jobTitle) =>
    item.text.split(/\s/).some((word) => word === jobTitle)
  );
const hasMoreThan5Words = (item: TextItem) => item.text.split(/\s/).length > 5;
const hasMoreThan8Words = (item: TextItem) => item.text.split(/\s/).length > 8;

// Signals for picking the employer out of an entry's header block.
//
// A legal suffix or an institution word is the strongest positive: it is the
// one thing only a company name carries. The negatives matter just as much,
// because an entry header also holds the employment type ("Full-time"), a
// field label ("Employer:"), a bare footnote marker ("1") and the location,
// and without them any of those can outscore the real employer.
// prettier-ignore
const COMPANY_WORDS = /(?:^|[^a-z])(?:inc|llc|l\.l\.c|ltd|limited|corp|corporation|company|co|plc|gmbh|ag|se|sa|s\.a|a\/s|ab|oy|bv|n\.v|pvt|pty|group|holdings?|labs?|technologies|technology|systems|solutions|services|software|digital|media|partners|ventures|capital|bank|university|college|institute|academy|school|hospital|clinic|foundation|agency|studio|consulting|associates)(?:[^a-z]|$)/i;
const hasCompanyWord = (item: TextItem) => COMPANY_WORDS.test(item.text);

// prettier-ignore
const EMPLOYMENT_TYPES = /^(?:full[\s-]?time|part[\s-]?time|contract(?:or)?|contractual|internship|intern|temporary|permanent|freelance|remote|hybrid|on[\s-]?site|seasonal|volunteer)\b/i;
const isEmploymentType = (item: TextItem) =>
  EMPLOYMENT_TYPES.test(item.text.trim());

// A bare field label rather than its value
// prettier-ignore
const FIELD_LABELS = /^(?:employer|company|organi[sz]ation|client|firm|institution|position|title|role|location|dates?|duration|period)\s*:?\s*$/i;
const isFieldLabel = (item: TextItem) => FIELD_LABELS.test(item.text.trim());

/**
 * Text that is *nothing but* a date, e.g. "February, 2023 - January, 2024".
 *
 * The employer is already penalised for containing the date extracted for the
 * same entry, but that guard does nothing when date extraction found nothing,
 * and then a bare date line can win the employer slot outright.
 *
 * The test has to be "mostly a date" rather than "contains a date": resumes
 * very often put the employer and its dates on one line ("Daraz February 2023 -
 * Now"), and penalising that line loses the employer instead.
 */
// Months matched exactly, as the abbreviation or the full name. A prefix match
// such as /mar[a-z]*/ would also eat "Marketing" and "Marchés", and /jun[a-z]*/
// would eat "Junior" -- stripping real words out of the employer's name.
// prettier-ignore
const MONTH_OR_YEAR = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b|\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\b|\b(?:19|20)\d{2}\b/gi;
// "now", "present" and "current" are ordinary words -- "Momentum Solutions (now
// Apex Systems)" is a company name -- so they are only removed once a month or
// a year has been found, which makes them the open end of a date range.
// prettier-ignore
const OPEN_ENDED = /\bpresent\b|\bcurrent\b|\bnow\b|\bsince\b|\bto\b/gi;

/** Remove the date parts of a string, leaving whatever else it holds. */
const stripDates = (text: string) => {
  const withoutMonths = text.replace(MONTH_OR_YEAR, " ");
  const foundADate = withoutMonths !== text;
  return foundADate ? withoutMonths.replace(OPEN_ENDED, " ") : text;
};
const isMostlyDate = (item: TextItem) => {
  const remainder = stripDates(item.text).replace(/[^a-z]/gi, "");
  return remainder.length < 4 && /\d/.test(item.text);
};
void isMostlyDate; // kept for reference; measured as an even trade, so unused

/** A footnote marker, page number or stray digit is never a company. */
/**
 * getHasText("") matches every item, so an unresolved field would penalise the
 * whole set. Guard it to a test that never fires instead.
 */
const getHasTextIfKnown = (text: string) =>
  text ? getHasText(text) : () => false;

const hasNoLetters = (item: TextItem) => !/[a-zA-Z]/.test(item.text);
const isVeryShort = (item: TextItem) => item.text.trim().length < 3;


export const extractExperience = (sections: CvSections): CvExperience[] => {
  const experience: CvExperience[] = [];
  const lines = findSection(
    sections,
    WORK_EXPERIENCE_KEYWORDS_LOWERCASE
  );
  const subsections = splitIntoSubsections(lines);

  for (const subsectionLines of subsections) {
    const descriptionsLineIdx = findDescriptionsLine(subsectionLines) ?? 2;

    const subsectionInfoTextItems = subsectionLines
      .slice(0, descriptionsLineIdx)
      .flat();
    const [date] = highestScoringText(
      subsectionInfoTextItems,
      DATE_FEATURE_SETS
    );
    // Company and job title each want to know what the other is, so they are
    // resolved in three steps rather than circularly.
    //
    // 1. A provisional title from the gazetteer alone. No structural signals,
    //    so a bold employer line cannot win this pass.
    const PROVISIONAL_JOB_TITLE_FEATURE_SET: FeatureSet[] = [
      [hasJobTitle, 4],
      [getHasText(date), -4],
      [hasCompanyWord, -3],
    ];
    const [provisionalJobTitle] = highestScoringText(
      subsectionInfoTextItems,
      PROVISIONAL_JOB_TITLE_FEATURE_SET
    );

    // 2. The employer, which may now rule out the provisional title. Its own
    //    signals are strong: a legal suffix or institution word says "company"
    //    outright, while an employment type, a field label or a bare footnote
    //    marker rule it out.
    const COMPANY_FEATURE_SET: FeatureSet[] = [
      [hasCompanyWord, 3],
      [isBold, 2],
      [getHasText(date), -4],
      [getHasTextIfKnown(provisionalJobTitle), -4],
      [hasJobTitle, -3],
      [isEmploymentType, -4],
      [isFieldLabel, -4],
      [hasNoLetters, -4],
      [isVeryShort, -4],
      [hasMoreThan5Words, -2], // a sentence, not a company name
    ];
    const [company] = highestScoringText(
      subsectionInfoTextItems,
      COMPANY_FEATURE_SET,
      false
    );

    // 3. The final title, which defers to the resolved employer. A gazetteer
    //    alone cannot keep up with invented titles ("Growth Hacker", "10x
    //    Developer"), so structure carries most of the weight here: an entry
    //    header is bold and is neither the date nor the employer. The digit
    //    penalty is mild because real titles carry numbers -- "Level V",
    //    "10x", "#4 employee".
    const JOB_TITLE_FEATURE_SET: FeatureSet[] = [
      [hasJobTitle, 4],
      [isBold, 2],
      [getHasText(date), -4],
      [getHasTextIfKnown(company), -4],
      [hasCompanyWord, -3],
      [hasNumber, -1],
      [hasMoreThan8Words, -2],
    ];
    const [jobTitle] = highestScoringText(
      subsectionInfoTextItems,
      JOB_TITLE_FEATURE_SET
    );

    // Resumes commonly put the employer and its dates on one line, so the
    // winning company value is often "Daraz February 2023 - Now". Scoring
    // cannot separate them -- penalising date-like text just loses the
    // employer instead, which measured as an even trade. Removing the date
    // that was already extracted for this same entry is deterministic: it
    // leaves "Daraz", and leaves nothing at all for a line that was only ever
    // a date, which is the honest answer in that case.
    const companyWithoutDate = (() => {
      // Only date *tokens* are removed, never the extracted date string as a
      // whole: when the employer and its dates share one line, the extracted
      // date is that entire line, so removing it would take the employer with
      // it and leave nothing.
      let text = stripDates(company);
      // Tidy the separators the date was sitting among
      text = text.replace(/[\s,;|\u2013\u2014-]+/g, " ").trim();
      return /[a-z]{2}/i.test(text) ? text : "";
    })();

    const subsectionDescriptionsLines =
      subsectionLines.slice(descriptionsLineIdx);
    const descriptions = getBulletPoints(subsectionDescriptionsLines);

    experience.push({ company: companyWithoutDate, jobTitle, date, descriptions });
  }
  return experience;
};
