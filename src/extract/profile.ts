import type { CvSections, CvProfile, TextItem, FeatureSet } from "../types";
import { findSection } from "../layout/lookup";
import {
  isBold,
  hasNumber,
  hasComma,
  hasLetter,
  hasLetterAndIsAllUpperCase,
} from "../scoring/features";
import { highestScoringText } from "../scoring/score";
import { joinWrappedText } from "../text/join";

// Resume templates often pack several contact details onto a single line and
// separate them with a glyph rather than whitespace, e.g.
// "9849501483⋄me@gmail.com⋄linkedin.com/in/me". Treating those glyphs as
// boundaries keeps one field from swallowing its neighbours.
const SEPARATOR_CHARS = "\\s,;|⋄•·∙●◦⁃‣▪▫⋅⦁❖";
const NOT_SEPARATOR = `[^${SEPARATOR_CHARS}]`;

// Name
export const matchOnlyLetterSpaceOrPeriod = (item: TextItem) =>
  item.text.match(/^[a-zA-Z\s\.]+$/);
// A person's name is almost always 2 to 3 words. This separates it from a lone
// bold uppercase word such as a skill badge ("PHP") sitting near the top.
const hasTwoOrThreeWords = (item: TextItem) => {
  const wordCount = item.text.trim().split(/\s+/).filter(Boolean).length;
  return wordCount >= 2 && wordCount <= 3;
};

// Email
// Email regex: xxx@xxx.xxx, where neither side may contain a separator glyph
const EMAIL_REGEX = new RegExp(
  `[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)*\\.[A-Za-z]{2,}`
);
// A pdf frequently glues the next contact field onto the email with no space,
// e.g. "me@gmail.comhttps://www.linkedin.com/in/me". Cut the address back to
// where that next field starts.
// prettier-ignore
const TLDS = ['com','org','net','edu','gov','mil','int','io','co','dev','app','ai','me','info','biz','xyz','online','site','tech','us','uk','ca','au','de','fr','nl','se','no','es','it','ch','pl','tr','in','np','jp','cn','br','ru','za'];
// Longest first so that ".com" is preferred over the ".co" prefix inside it
const TLDS_LONGEST_FIRST = [...TLDS].sort((a, b) => b.length - a.length);
// A known tld immediately followed by the start of another contact field is
// glue, e.g. "me@gmail.comhttps://..." or "me@gmail.comPhone: 123". The
// lookahead is required: without it ".co" would match inside ".com" and
// silently drop the final letter of the address.
const GLUED_FIELD_REGEX = new RegExp(
  `\\.(?:${TLDS_LONGEST_FIRST.join("|")})(?=https?|www\\.|[A-Z])`
);
export const matchEmail = (item: TextItem) => {
  const match = item.text.match(EMAIL_REGEX);
  if (!match) return null;
  let email = match[0];

  const glue = email.match(GLUED_FIELD_REGEX);
  if (glue && glue.index !== undefined) {
    email = email.slice(0, glue.index + glue[0].length);
  }

  // Drop trailing punctuation, e.g. "me@gmail.com."
  email = email.replace(/[.,;:]+$/, "");
  return [email] as unknown as RegExpMatchArray;
};
const hasAt = (item: TextItem) => item.text.includes("@");

// Phone
// Phone numbers come in many shapes: "(123)-456-7890", "+977 986-7481189",
// "9849501483". Collect every digit group that is formatted like a phone number
// and keep the first one whose digit count is plausible. The old regex matched a
// fixed 3-3-4 shape, which silently truncated international numbers.
const PHONE_CANDIDATE_REGEX =
  /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d{2,4}(?:[\s.-]?\d{2,4}){1,4}/g;
const countDigits = (text: string) => (text.match(/\d/g) ?? []).length;
// "2020 - 2023" and "2020-2023" are dates, not phone numbers
const YEAR_RANGE_REGEX =
  /^(?:19|20)\d{2}\s*[-–—]\s*(?:(?:19|20)\d{2})?$/;
export const matchPhone = (item: TextItem) => {
  const candidates = item.text.match(PHONE_CANDIDATE_REGEX);
  if (!candidates) return null;
  for (const candidate of candidates) {
    const phone = candidate.trim().replace(/^[.\s-]+|[.\s-]+$/g, "");
    const digitCount = countDigits(phone);
    // A phone number has at least 9 digits once the country/area code is
    // included, and E.164 caps it at 15
    if (digitCount < 9 || digitCount > 15) continue;
    if (YEAR_RANGE_REGEX.test(phone)) continue;
    return [phone] as unknown as RegExpMatchArray;
  }
  return null;
};
const hasParenthesis = (item: TextItem) => /\([0-9]+\)/.test(item.text);

// Location
// Location regex that matches "<City>, <ST>". Every word of the city has to be
// capitalized and the state code must not run into another word, otherwise a
// sentence in the summary matches too, e.g. "Strong foundation in OOP, RESTful"
// used to come back as a location.
export const matchCityAndState = (item: TextItem) =>
  item.text.match(
    /[A-Z][a-zA-Z.'-]*(?:[ ][A-Z][a-zA-Z.'-]*)*,[ ]?[A-Z]{2}(?![A-Za-z])/
  );
// Fallback for locations outside the US, e.g. "Kathmandu, Bagmati, Nepal." or
// "Bhaktapur, Nepal". Anchored to the whole text item so that a comma in a
// sentence of the summary cannot match.
export const matchCityAndCountry = (item: TextItem) =>
  item.text
    .trim()
    .match(
      /^[A-Z][a-zA-Z.'-]*(?:[ ][A-Z][a-zA-Z.'-]*)*(?:,[ ]?[A-Z][a-zA-Z.'-]*(?:[ ][A-Z][a-zA-Z.'-]*)*){1,2}\.?$/
    );

// Url
// Url regex that matches "xxx.xxx/xxx", stopping at separator glyphs and "@" so
// that an email sitting next to it is not absorbed
const NOT_SEPARATOR_OR_AT = `[^@${SEPARATOR_CHARS}]`;
export const matchUrl = (item: TextItem) =>
  item.text.match(
    new RegExp(
      `${NOT_SEPARATOR_OR_AT}+\\.[a-z]{2,}\\/${NOT_SEPARATOR_OR_AT}*`,
      "i"
    )
  );
// Match https://xxx.xxx where s is optional. Scored above the generic url match
// because the scheme gives an unambiguous starting point.
const matchUrlHttpFallback = (item: TextItem) =>
  item.text.match(new RegExp(`https?:\\/\\/${NOT_SEPARATOR}+\\.${NOT_SEPARATOR}+`, "i"));
// Match www.xxx.xxx
const matchUrlWwwFallback = (item: TextItem) =>
  item.text.match(new RegExp(`www\\.${NOT_SEPARATOR}+\\.${NOT_SEPARATOR}+`, "i"));
const hasSlash = (item: TextItem) => item.text.includes("/");

// Summary
const has4OrMoreWords = (item: TextItem) => item.text.split(" ").length >= 4;

/**
 * Stock section headings, which are never a person's name.
 *
 * Headings detected in the document are already excluded from the candidates,
 * but a heading the sectioning did not pick up is still in the running -- and
 * on a resume whose name is set no larger than its headings, "PROFESSIONAL
 * SUMMARY" can win the name outright.
 */
// prettier-ignore
const HEADING_PHRASES = /^(?:professional\s+)?(?:summary|profile|objective|experience|education|skills|projects|certifications|languages|interests|references|contact|achievements|awards|publications|work\s+experience|employment\s+history|career\s+objective|personal\s+(?:details|information)|curriculum\s+vitae|resume|cv)$/i;
const isHeadingPhrase = (item: TextItem) =>
  HEADING_PHRASES.test(item.text.trim().replace(/\s+/g, " "));

/**
 *              Unique Attribute
 * Name         Bold or Has all uppercase letter
 * Email        Has @
 * Phone        Has ()
 * Location     Has ,    (overlap with summary)
 * Url          Has slash
 * Summary      Has 4 or more words
 */

/**
 * Name -> contains only letters/space/period, e.g. Leonardo W. DiCaprio
 *         (it isn't common to include middle initial in resume)
 *      -> is bolded or has all letters as uppercase
 */
// A resume sets the name in the largest type on the page far more reliably than
// it bolds or capitalizes it, so the feature set is built per resume.
const nameFeatureSets = (textItems: TextItem[]): FeatureSet[] => {
  const maxHeight = Math.max(0, ...textItems.map((item) => item.height));
  // Allow a small tolerance so that a name split across text items with
  // marginally different heights still counts
  const isLargestTextOnPage = (item: TextItem) =>
    maxHeight > 0 && item.height >= maxHeight * 0.95;

  return [
    [matchOnlyLetterSpaceOrPeriod, 3, true],
    [isLargestTextOnPage, 3],
    [isBold, 2],
    [hasLetterAndIsAllUpperCase, 2],
    [hasTwoOrThreeWords, 2],
    // Match against other unique attributes
    [hasAt, -4], // Email
    [hasNumber, -4], // Phone
    [hasParenthesis, -4], // Phone
    [hasComma, -4], // Location
    [hasSlash, -4], // Url
    [has4OrMoreWords, -2], // Summary
  ];
};

// Email -> match email regex xxx@xxx.xxx
const EMAIL_FEATURE_SETS: FeatureSet[] = [
  [matchEmail, 4, true],
  [isBold, -1], // Name
  [hasLetterAndIsAllUpperCase, -1], // Name
  [hasParenthesis, -4], // Phone
  [hasComma, -4], // Location
  [hasSlash, -4], // Url
  [has4OrMoreWords, -4], // Summary
];

// Phone -> match phone regex (xxx)-xxx-xxxx
const PHONE_FEATURE_SETS: FeatureSet[] = [
  [matchPhone, 4, true],
  [hasLetter, -4], // Name, Email, Location, Url, Summary
];

// Location -> match location regex <City>, <ST>
const LOCATION_FEATURE_SETS: FeatureSet[] = [
  [matchCityAndState, 4, true],
  [matchCityAndCountry, 3, true],
  [isBold, -1], // Name
  [hasAt, -4], // Email
  [hasParenthesis, -3], // Phone
  [hasSlash, -4], // Url
  [hasNumber, -2], // Phone
];

// URL -> match url regex xxx.xxx/xxx
const URL_FEATURE_SETS: FeatureSet[] = [
  // An explicit scheme or "www." makes the start of the url unambiguous, so
  // those are scored above the bare "xxx.xxx/xxx" shape
  [matchUrlHttpFallback, 4, true],
  [matchUrlWwwFallback, 4, true],
  [matchUrl, 3, true],
  [isBold, -1], // Name
  [hasAt, -4], // Email
  [hasParenthesis, -3], // Phone
  [hasComma, -4], // Location
  [has4OrMoreWords, -4], // Summary
];

// Summary -> has 4 or more words
const SUMMARY_FEATURE_SETS: FeatureSet[] = [
  [has4OrMoreWords, 4],
  [isBold, -1], // Name
  [hasAt, -4], // Email
  [hasParenthesis, -3], // Phone
  [matchCityAndState, -4, false], // Location
  [matchCityAndCountry, -4, false], // Location
];

export const extractProfile = (sections: CvSections): CvProfile => {
  const lines = sections.profile ?? [];
  // Many templates put the contact details under their own heading rather than
  // in the unnamed block at the top, so draw on both.
  const contactLines = findSection(sections, [
    "contact",
    "personal detail",
    "personal information",
  ]);
  const textItems = [...lines, ...contactLines].flat();

  // A resume with its name redacted leaves the job-title banner as the largest
  // bold text on the page, and that banner is often also a detected heading.
  // Excluding heading text stops it being reported as the candidate's name.
  const headings = new Set(
    Object.keys(sections)
      .filter((name) => name !== "profile")
      .map((name) => name.toLowerCase().trim())
  );
  // Excluded outright rather than penalised: a heading set in the largest bold
  // type on the page scores high enough to win the name even with a penalty
  // applied.
  const nameCandidates = textItems.filter(
    (candidate) =>
      !headings.has(candidate.text.toLowerCase().trim()) &&
      !isHeadingPhrase(candidate)
  );

  const [name] = highestScoringText(
    nameCandidates,
    nameFeatureSets(nameCandidates)
  );
  const [email] = highestScoringText(textItems, EMAIL_FEATURE_SETS);
  const [phone] = highestScoringText(textItems, PHONE_FEATURE_SETS);
  const [location] = highestScoringText(textItems, LOCATION_FEATURE_SETS);
  const [url] = highestScoringText(textItems, URL_FEATURE_SETS);
  const [inlineSummary] = highestScoringText(
    textItems,
    SUMMARY_FEATURE_SETS,
    undefined,
    true
  );

  // A dedicated summary or objective section beats a guess from the header
  // "profile" is deliberately absent: it is the key for the unnamed header
  // block, and matching it here would return the contact details as a summary.
  const summarySection = joinSection(sections, [
    "professional summary",
    "summary",
    "professional philosophy",
    "philosophy",
    "overview",
    "about",
  ]);
  const objectiveSection = joinSection(sections, [
    "career objective",
    "objective",
    // Vietnamese
    "mục tiêu nghề nghiệp",
    "mục tiêu",
    "giới thiệu",
  ]);

  return {
    name,
    email,
    phone,
    location,
    url,
    summary: summarySection || objectiveSection || inlineSummary,
  };
};

const joinSection = (sections: CvSections, keywords: string[]) =>
  joinWrappedText(
    findSection(sections, keywords)
      .flat()
      .map((item) => item.text)
  );
