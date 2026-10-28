// Audit an extraction over a directory of cv pdfs, using properties that any
// correct result must satisfy. No ground truth needed.
//
//   npm run build
//   node scripts/audit-corpus.mjs /path/to/pdfs
//
// check-corpus.mjs says whether a field was filled, and score-bench.mjs says
// whether it was right -- but that needs labels, and labels are scarce. These
// checks need none: they look for results that contradict themselves or the
// document they came from, which is enough to find whole classes of bug.

import fs from "node:fs";
import path from "node:path";
import { createWasmEngine, extractCvFromItems, toSections, toLines } from "../dist/index.js";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: node scripts/audit-corpus.mjs <corpus-dir>");
  process.exit(2);
}
const limit = Number(process.argv[3] ?? Infinity);

const engine = createWasmEngine(
  process.env.FLASH_CV_WASM ?? "dist/flash-cv-pdf-core.wasm"
);

const norm = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const BULLETS = /[•·●◦⁃‣▪▫⋅∙⋄]/;

/** Each check: a name and a function returning a complaint, or nothing. */
const checks = [
  // --- the value must be present in the document it came from ---
  ["email not in document", (cv, text) =>
    cv.profile.email && !norm(text).includes(norm(cv.profile.email))
      ? cv.profile.email : null],
  ["name not in document", (cv, text) =>
    cv.profile.name && !norm(text).includes(norm(cv.profile.name))
      ? cv.profile.name : null],
  // Word level, not verbatim: the company value has its dates removed, so it is
  // a derived string. Every word of it must still come from the document.
  ["company words not in document", (cv, text) => {
    const haystack = norm(text);
    const bad = cv.experience.find((e) => {
      if (!e.company) return false;
      return norm(e.company)
        .split(" ")
        .filter((w) => w.length > 2)
        .some((w) => !haystack.includes(w));
    });
    return bad ? bad.company : null;
  }],

  // --- a field must not be a different field ---
  ["company equals job title", (cv) => {
    const bad = cv.experience.find(
      (e) => e.company && e.jobTitle && norm(e.company) === norm(e.jobTitle));
    return bad ? bad.company : null;
  }],
  ["school equals degree", (cv) => {
    const bad = cv.education.find(
      (e) => e.school && e.degree && norm(e.school) === norm(e.degree));
    return bad ? bad.school : null;
  }],
  ["name equals a section heading", (cv, _t, sections) =>
    cv.profile.name && sections.some((s) => norm(s) === norm(cv.profile.name))
      ? cv.profile.name : null],
  ["company is a section heading", (cv, _t, sections) => {
    const bad = cv.experience.find(
      (e) => e.company && sections.some((s) => norm(s) === norm(e.company)));
    return bad ? bad.company : null;
  }],

  // --- a field must not carry another field's shape ---
  ["name contains an email or url", (cv) =>
    /[@]|https?:\/\//.test(cv.profile.name) ? cv.profile.name : null],
  ["name contains a digit", (cv) =>
    /\d/.test(cv.profile.name) ? cv.profile.name : null],
  ["date has no year", (cv) => {
    const bad = cv.experience.find((e) => e.date && !/(?:19|20)\d{2}/.test(e.date));
    return bad ? bad.date : null;
  }],
  ["gpa out of range", (cv) => {
    const bad = cv.education.find((e) => {
      const n = parseFloat(e.gpa);
      return e.gpa && Number.isFinite(n) && (n < 0 || n > 110);
    });
    return bad ? bad.gpa : null;
  }],

  // A company line routinely carries its own dates ("Daraz February 2023 -
  // Now"), so only a value that is *nothing but* a date counts as a fault.
  ["company is only a date", (cv) => {
    const DATE_TOKENS = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|\b(?:19|20)\d{2}\b|\bpresent\b|\bnow\b|\bto\b|\bsince\b/gi;
    const bad = cv.experience.find((e) => {
      if (!e.company || !/\d/.test(e.company)) return false;
      return e.company.replace(DATE_TOKENS, "").replace(/[^a-z]/gi, "").length < 4;
    });
    return bad ? bad.company : null;
  }],
  ["name is a stock heading", (cv) =>
    /^(?:professional\s+)?(?:summary|profile|objective|experience|education|skills|projects|certifications|languages|contact|curriculum\s+vitae|resume|cv)$/i
      .test(norm(cv.profile.name)) ? cv.profile.name : null],

  // --- leftover markup ---
  ["bullet left in a field", (cv) => {
    const fields = [cv.profile.name, cv.profile.location,
      ...cv.experience.flatMap((e) => [e.company, e.jobTitle]),
      ...cv.education.map((e) => e.school), ...cv.projects.map((p) => p.name)];
    return fields.find((f) => f && BULLETS.test(f)) ?? null;
  }],
  ["field is suspiciously long", (cv) => {
    const over = [["name", cv.profile.name, 60], ["location", cv.profile.location, 80],
      ...cv.experience.map((e) => ["company", e.company, 90]),
      ...cv.education.map((e) => ["school", e.school, 110])];
    const bad = over.find(([, v, max]) => v && v.length > max);
    return bad ? `${bad[0]}: ${String(bad[1]).slice(0, 50)}` : null;
  }],

  // --- duplicates suggest a splitting fault ---
  ["duplicate experience entries", (cv) => {
    const keys = cv.experience.map((e) => norm(e.company) + "|" + norm(e.jobTitle) + "|" + norm(e.date));
    const dup = keys.find((k, i) => k !== "||" && keys.indexOf(k) !== i);
    return dup ?? null;
  }],
];

const tally = Object.fromEntries(checks.map(([name]) => [name, { n: 0, eg: [] }]));
let total = 0, threw = 0;

const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".pdf")).sort().slice(0, limit);
for (const file of files) {
  total++;
  let cv, items;
  try {
    items = await engine(new Uint8Array(fs.readFileSync(path.join(dir, file))));
    cv = extractCvFromItems(items);
  } catch { threw++; continue; }

  // Compare against the line-merged text, which is what extraction actually
  // sees. The engine can split a word across items (accented text is often set
  // with its diacritics in a separate font), so the raw item list is not a
  // fair reference for "is this value present in the document".
  const text = toLines(items)
    .map((line) => line.map((i) => i.text).join(" "))
    .join(" ");
  const sections = Object.keys(toSections(items));
  for (const [name, check] of checks) {
    let complaint;
    try { complaint = check(cv, text, sections); } catch { complaint = "check threw"; }
    if (complaint) {
      const t = tally[name];
      t.n++;
      if (t.eg.length < 2) t.eg.push(`${file.slice(0, 30)}: ${String(complaint).slice(0, 56)}`);
    }
  }
}

const pct = (n) => `${((100 * n) / total).toFixed(1)}%`;
console.log(`\naudited ${total} pdfs (${threw} threw)\n`);
const rows = checks.map(([name]) => [name, tally[name]]).sort((a, b) => b[1].n - a[1].n);
for (const [name, t] of rows) {
  console.log(`${String(t.n).padStart(6)}  ${pct(t.n).padStart(6)}  ${name}`);
}
console.log("\nexamples for the top findings:");
for (const [name, t] of rows.filter(([, t]) => t.n > 0).slice(0, 6)) {
  console.log(`  ${name}`);
  for (const e of t.eg) console.log(`     ${e}`);
}
