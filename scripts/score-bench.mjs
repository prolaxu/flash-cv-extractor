// Score the extractor against a labelled benchmark (per-field ground truth).
//
//   npm run build
//   bash scripts/fetch-corpus.sh bench ./corpus/bench
//   node scripts/score-bench.mjs ./corpus/bench
//
// Unlike check-corpus.mjs, which only reports whether a field got *filled*,
// this compares the value against the expected one.
//
// The benchmark's schema is more structured than ours in three places, and the
// comparison is deliberately generous about exactly those, because they are
// differences in shape rather than extraction failures:
//
//   * it splits the name into fname/lname, we return one string
//   * it splits dates into start/end month/year, we return the date line as text
//   * it stores city/state/country separately, we return one location string
//
// Everything else is compared on normalised equality or containment.

import fs from "node:fs";
import path from "node:path";
import { extractCvFromItems, createWasmEngine } from "../dist/index.js";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: node scripts/score-bench.mjs <corpus-dir>");
  process.exit(2);
}

const WASM = process.env.FLASH_CV_WASM ?? "dist/flash-cv-pdf-core.wasm";
const engine = createWasmEngine(WASM);

// ---------------------------------------------------------------------------
// normalisation
// ---------------------------------------------------------------------------

const norm = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[‐-―]/g, "-")
    .replace(/[^a-z0-9@.+/\- ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const digits = (s) => String(s ?? "").replace(/\D/g, "");

/** Two strings count as the same if either contains the other. */
const loosely = (a, b) => {
  const [x, y] = [norm(a), norm(b)];
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
};

// ---------------------------------------------------------------------------
// tallies
// ---------------------------------------------------------------------------

/** A scalar field: did we produce the expected value? */
const scalar = () => ({ correct: 0, wrong: 0, missed: 0, na: 0, examples: [] });

const judgeScalar = (tally, expected, actual, id, matcher = loosely) => {
  const want = String(expected ?? "").trim();
  const got = String(actual ?? "").trim();
  if (!want) {
    tally.na++; // the benchmark has no value, so there is nothing to score
    return;
  }
  if (!got) {
    tally.missed++;
    if (tally.examples.length < 3) tally.examples.push(`${id}: missed, wanted ${JSON.stringify(want.slice(0, 40))}`);
    return;
  }
  if (matcher(got, want)) tally.correct++;
  else {
    tally.wrong++;
    if (tally.examples.length < 3)
      tally.examples.push(`${id}: got ${JSON.stringify(got.slice(0, 34))} wanted ${JSON.stringify(want.slice(0, 34))}`);
  }
};

/** A list field: how many expected entries did we find, and how clean were we? */
const list = () => ({ expected: 0, found: 0, produced: 0, matched: 0, recalls: [] });

const judgeList = (tally, expectedKeys, producedKeys) => {
  const want = expectedKeys.map(norm).filter(Boolean);
  const got = producedKeys.map(norm).filter(Boolean);
  tally.expected += want.length;
  tally.produced += got.length;

  const unused = [...got];
  let found = 0;
  for (const w of want) {
    const i = unused.findIndex((g) => g === w || g.includes(w) || w.includes(g));
    if (i !== -1) {
      found++;
      unused.splice(i, 1);
    }
  }
  tally.found += found;
  tally.matched += found;
  if (want.length) tally.recalls.push(found / want.length);
};

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------

const records = fs
  .readFileSync(path.join(dir, "test.jsonl"), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l));

const fields = {
  name: scalar(),
  email: scalar(),
  phone: scalar(),
  location: scalar(),
  summary: scalar(),
};
const lists = {
  "experience.company": list(),
  "experience.jobTitle": list(),
  "education.school": list(),
  "projects.name": list(),
  "certifications": list(),
};
const dateHits = { total: 0, hit: 0 };
const byDifficulty = {};
let parsed = 0;
let failed = 0;
const noTextLayer = [];
const notes = [];

for (const rec of records) {
  // The fetch script flattens nested paths to "<dir>__<file>"
  const pdfName = rec.files.pdf.split("/").slice(-2).join("__");
  const pdfPath = path.join(dir, pdfName);
  if (!fs.existsSync(pdfPath)) {
    notes.push(`${rec.resume_id}: pdf not found (${pdfName})`);
    failed++;
    continue;
  }

  let cv;
  let items;
  try {
    items = await engine(new Uint8Array(fs.readFileSync(pdfPath)));
    cv = extractCvFromItems(items);
    parsed++;
  } catch (e) {
    notes.push(`${rec.resume_id}: THREW ${e.message}`);
    failed++;
    continue;
  }

  // A pdf with no text layer is a scan. There is nothing to extract without
  // OCR, so counting it as an extraction failure would misreport accuracy;
  // it is reported separately instead.
  if (items.length === 0) {
    noTextLayer.push(rec.resume_id);
    continue;
  }

  const gt = rec.ground_truth;
  const b = gt.basics ?? {};
  const id = rec.resume_id.slice(0, 32);

  // name: ours is one string, theirs is split
  judgeScalar(fields.name, [b.fname, b.lname].filter(Boolean).join(" "), cv.profile.name, id, (got, want) => {
    const g = norm(got);
    return want.split(" ").filter(Boolean).every((part) => g.includes(norm(part)));
  });

  judgeScalar(fields.email, b.email, cv.profile.email, id, (got, want) => norm(got) === norm(want));

  // phone: compare the last 10 digits, so formatting and country code differences do not count against us
  judgeScalar(fields.phone, b.phone, cv.profile.phone, id, (got, want) => {
    const [g, w] = [digits(got), digits(want)];
    return g.length >= 7 && w.length >= 7 && g.slice(-10) === w.slice(-10);
  });

  // location: theirs is split into city/state/country, ours is one string
  judgeScalar(fields.location, [b.city, b.state].filter(Boolean).join(" "), cv.profile.location, id, (got, want) => {
    const g = norm(got);
    return want.split(" ").filter(Boolean).some((part) => g.includes(norm(part)));
  });

  judgeScalar(fields.summary, gt.personalSummary, cv.profile.summary, id, (got, want) => {
    // A summary is long; require a solid shared opening rather than equality
    const [g, w] = [norm(got), norm(want)];
    const head = w.split(" ").slice(0, 6).join(" ");
    return g.includes(head) || w.includes(g.split(" ").slice(0, 6).join(" "));
  });

  judgeList(lists["experience.company"], (gt.experience ?? []).map((e) => e.company), cv.experience.map((e) => e.company));
  judgeList(lists["experience.jobTitle"], (gt.experience ?? []).map((e) => e.position), cv.experience.map((e) => e.jobTitle));
  judgeList(lists["education.school"], (gt.education ?? []).map((e) => e.institution), cv.education.map((e) => e.school));
  judgeList(lists["projects.name"], (gt.projects ?? []).map((p) => p.name), cv.projects.map((p) => p.name));
  judgeList(lists["certifications"], (gt.certifications ?? []).map((c) => c.name), cv.certifications);

  // dates: we return the date line verbatim, so check the years appear in it
  for (const exp of gt.experience ?? []) {
    if (!exp.startYear) continue;
    dateHits.total++;
    const ours = cv.experience.map((e) => e.date).join(" | ");
    if (ours.includes(String(exp.startYear))) dateHits.hit++;
  }

  const d = rec.difficulty ?? "unknown";
  byDifficulty[d] ??= { n: 0, nameOk: 0, emailOk: 0 };
  byDifficulty[d].n++;
  if (cv.profile.name && norm(cv.profile.name).includes(norm(b.lname ?? "")) && b.lname) byDifficulty[d].nameOk++;
  if (cv.profile.email && norm(cv.profile.email) === norm(b.email ?? "")) byDifficulty[d].emailOk++;
}

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : "   -  ");

const scored = parsed - noTextLayer.length;
console.log(`\nbenchmark: ${records.length} records`);
console.log(`  opened without error : ${parsed}`);
console.log(`  no text layer (scans): ${noTextLayer.length}   <- needs OCR, excluded from accuracy`);
console.log(`  failed to open       : ${failed}`);
console.log(`  SCORED               : ${scored}\n`);

console.log("scalar fields (accuracy over records where the benchmark has a value)");
console.log("  field       correct  wrong  missed   n/a   accuracy");
for (const [name, t] of Object.entries(fields)) {
  const applicable = t.correct + t.wrong + t.missed;
  console.log(
    `  ${name.padEnd(11)}${String(t.correct).padStart(7)}${String(t.wrong).padStart(7)}` +
      `${String(t.missed).padStart(8)}${String(t.na).padStart(6)}   ${pct(t.correct, applicable)}`
  );
}

console.log("\nlist fields (recall: expected entries we found)");
console.log("  field                    expected  found   recall   we produced");
for (const [name, t] of Object.entries(lists)) {
  console.log(
    `  ${name.padEnd(24)}${String(t.expected).padStart(9)}${String(t.found).padStart(7)}` +
      `   ${pct(t.found, t.expected).padStart(7)}${String(t.produced).padStart(14)}`
  );
}

console.log(`\nexperience start year present in our date string: ${dateHits.hit}/${dateHits.total} (${pct(dateHits.hit, dateHits.total)})`);

console.log("\nby difficulty");
console.log("  level        n   surname found   email exact");
for (const [level, d] of Object.entries(byDifficulty).sort()) {
  console.log(`  ${level.padEnd(10)}${String(d.n).padStart(4)}${pct(d.nameOk, d.n).padStart(14)}${pct(d.emailOk, d.n).padStart(14)}`);
}

const misses = Object.entries(fields).flatMap(([f, t]) => t.examples.map((e) => `  ${f}: ${e}`));
if (misses.length) {
  console.log("\nsample misses");
  for (const m of misses.slice(0, 12)) console.log(m);
}
if (notes.length) {
  console.log("\nnotes");
  for (const n of notes.slice(0, 8)) console.log(`  ${n}`);
}
