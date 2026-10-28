/**
 * Join pieces of text that were split across lines, undoing hyphenation.
 *
 * Justified text breaks words at the margin, so a pdf yields "compe-" then
 * "tencies" on the next line. Joining with a space leaves "compe- tencies",
 * which reads badly and defeats any match on the real word.
 */
export const joinWrappedText = (parts: string[]): string => {
  let joined = "";
  for (const raw of parts) {
    const part = raw.trim();
    if (!part) continue;
    if (!joined) {
      joined = part;
      continue;
    }
    // A hyphen after a lowercase letter, continued by a lowercase letter, is
    // word wrapping rather than a real hyphen
    if (/[a-z]-$/.test(joined) && /^[a-z]/.test(part)) {
      // Unless only a letter or two precede it: "e-", "co-", "re-" are real
      // compound prefixes, so "e-" + "commerce" keeps its hyphen rather than
      // becoming "ecommerce".
      const prefix = joined.slice(0, -1).match(/[a-z]+$/)?.[0] ?? "";
      joined =
        prefix.length <= 2 ? joined + part : joined.slice(0, -1) + part;
    } else {
      joined += " " + part;
    }
  }
  return joined;
};
