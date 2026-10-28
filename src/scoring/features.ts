import type { TextItem, FeatureSet } from "../types";

// Font names that mark a bold face. A pdf font name looks like
// "BCDEEE+Calibri-Bold" or, for LaTeX documents, "VHRLZF+CMBX12".
// prettier-ignore
const BOLD_FONT_NAME_KEYWORDS = ['bold', 'black', 'heavy', 'semib', 'demib'];
// Computer Modern (LaTeX) bold faces are named CMB*, CMBX* and CMSSB*, none of
// which contain the word "bold", e.g. CMBX12 = Computer Modern Bold eXtended.
const COMPUTER_MODERN_BOLD = /(?:^|[^a-z])cm(?:ss)?b/;
// Abbreviated bold suffixes, e.g. "Arial-BD", "Helvetica,Bd"
const ABBREVIATED_BOLD = /[-,_ ]bd(?:[^a-z]|$)/;
const isTextItemBold = (fontName: string) => {
  const name = fontName.toLowerCase();
  return (
    BOLD_FONT_NAME_KEYWORDS.some((keyword) => name.includes(keyword)) ||
    COMPUTER_MODERN_BOLD.test(name) ||
    ABBREVIATED_BOLD.test(name)
  );
};
export const isBold = (item: TextItem) => isTextItemBold(item.fontName);
export const hasLetter = (item: TextItem) => /[a-zA-Z]/.test(item.text);
export const hasNumber = (item: TextItem) => /[0-9]/.test(item.text);
export const hasComma = (item: TextItem) => item.text.includes(",");
export const getHasText = (text: string) => (item: TextItem) =>
  item.text.includes(text);
export const hasOnlyLettersSpacesAmpersands = (item: TextItem) =>
  /^[A-Za-z\s&]+$/.test(item.text);
export const hasLetterAndIsAllUpperCase = (item: TextItem) =>
  hasLetter(item) && item.text.toUpperCase() === item.text;

// Date Features
const hasYear = (item: TextItem) => /(?:19|20)\d{2}/.test(item.text);
// prettier-ignore
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const hasMonth = (item: TextItem) =>
  MONTHS.some(
    (month) =>
      item.text.includes(month) || item.text.includes(month.slice(0, 4))
  );
const SEASONS = ["Summer", "Fall", "Spring", "Winter"];
const hasSeason = (item: TextItem) =>
  SEASONS.some((season) => item.text.includes(season));
const hasPresent = (item: TextItem) => item.text.includes("Present");
export const DATE_FEATURE_SETS: FeatureSet[] = [
  [hasYear, 1],
  [hasMonth, 1],
  [hasSeason, 1],
  [hasPresent, 1],
  [hasComma, -1],
];
