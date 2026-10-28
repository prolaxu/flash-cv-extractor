# flash-cv-extractor

Extract structured data from CV/resume PDFs. The PDF engine is written in Rust
and compiled to WebAssembly, so there is no worker to configure, no companion
JavaScript, and nothing to wire up in a bundler.

```typescript
import { extractCv, createWasmEngine } from "flash-cv-extractor";

const engine = createWasmEngine("/flash-cv-pdf-core.wasm");
const cv = await extractCv(pdfBytes, { engine });

cv.profile.name;        // "Suresh Tamang"
cv.profile.email;       // "itsmesureshtamang@gmail.com"
cv.experience.length;   // 3
```

## Why

Most PDF text extractors give you a wall of text. Reading a CV needs more than
that: you have to know which line is a heading, which words are emphasised, and
where the columns are. That needs two things per text run:

- **the real font name** — `CMBX12`, `Calibri-Bold` — because that is how
  emphasis is detected. `CMBX12` is Computer Modern **B**old e**X**tended; it
  contains no "bold" anywhere, which is why naive checks miss LaTeX documents.
- **geometry** — x, y, width and height, used to group lines, find columns, and
  spot the name as the largest text on the page.

The engine is built to supply exactly that, and nothing else.

## Install

```bash
npm install flash-cv-extractor
```

The `.wasm` file ships in the package. Serve it as a static asset and point the
engine at it:

```typescript
// Vite / webpack 5
import wasmUrl from "flash-cv-extractor/wasm?url";
const engine = createWasmEngine(wasmUrl);

// Or any url, including a CDN
const engine = createWasmEngine("https://cdn.example.com/flash-cv-pdf-core.wasm");

// Node: a filesystem path works too
const engine = createWasmEngine("./node_modules/flash-cv-extractor/dist/flash-cv-pdf-core.wasm");
```

Create the engine **once** and reuse it. The wasm module is compiled on first
use and cached for every document after that.

## Usage

`extractCv` takes bytes, a path, or a URL:

```typescript
await extractCv(new Uint8Array(await file.arrayBuffer()), { engine });
await extractCv("./resume.pdf", { engine });          // Node
await extractCv("https://example.com/cv.pdf", { engine });
```

### Result

```typescript
interface Cv {
  profile: {
    name: string;
    email: string;
    phone: string;
    url: string;
    location: string;
    summary: string;
  };
  experience: { company; jobTitle; date; descriptions: string[] }[];
  education: { school; degree; date; gpa; descriptions: string[] }[];
  projects: { name; date; descriptions: string[] }[];
  skills: { featured: string[]; descriptions: string[] };
  certifications: string[];
  languages: string[];
}
```

Every field is best-effort. A missing value is `""` or `[]`, never `undefined`,
so you can render it without guarding.

### Working with the steps

The pipeline is four steps, and each is exported:

```typescript
import { toLines, toSections, extractCvFromItems } from "flash-cv-extractor";

const items = await engine(pdfBytes);  // 1. pdf      -> text items
const lines = toLines(items);          // 2. items    -> lines
const sections = toSections(items);    // 3. lines    -> sections
const cv = extractCvFromItems(items);  // 4. sections -> cv

// Useful when a cv comes out wrong: see how it was divided up
console.log(Object.keys(sections));
```

### Bring your own engine

An engine is just a function. Anything that returns positioned text items works:

```typescript
import type { PdfEngine } from "flash-cv-extractor";

const myEngine: PdfEngine = async (source) => [
  { text: "Jane Doe", x: 20, y: 700, width: 80, height: 18,
    fontName: "Helvetica-Bold", hasEOL: true },
];
```

## How it works

| Step | What happens |
| --- | --- |
| 1. Read | The Rust engine walks the content streams and emits one item per text run, with its real font name and position. A two column page is put into reading order here. |
| 2. Lines | Items are grouped by end-of-line marker, and neighbours closer than a character width are merged. |
| 3. Sections | Every line is filed under the nearest heading above it. A heading is recognised from emphasis (bold and/or all caps, up to five words) or from a keyword. |
| 4. Extract | Each field has a set of scored tests; the highest scoring text item in the relevant section wins. |

Step 4 is a feature scoring system rather than a list of regexes. To find the
name, for instance, being the largest text on the page scores +3, being bold
+2, having two or three words +2, while containing an `@` scores −4. The item
with the best total wins. That is what makes it tolerant of CVs that break any
single rule.

## Layout

```
src/
  index.ts          public api
  types.ts          TextItem in, Cv out
  pipeline.ts       the four steps, wired together
  engine/
    types.ts        the PdfEngine contract
    wasm.ts         loads the rust engine, no glue code
  layout/
    columns.ts      two column detection, reading order
    lines.ts        text items -> lines
    sections.ts     lines -> sections, heading detection
    subsections.ts  a section -> one entry per job/school
    lookup.ts       find a section by keyword
  scoring/
    features.ts     reusable tests: bold, dates, numbers
    score.ts        the feature scoring engine
  text/
    bullets.ts      bullet points -> description lists
  extract/
    profile.ts experience.ts education.ts projects.ts
    skills.ts certifications.ts languages.ts

crates/pdf-core/    the rust engine (see its own README)
```

## Development

```bash
npm install
npm run build:wasm   # cargo -> dist/flash-cv-pdf-core.wasm
npm run build        # wasm + js bundle
npm run check        # typecheck + js tests + rust tests
```

The engine needs the Rust wasm target once:

```bash
rustup target add wasm32-unknown-unknown
```

Tests over real CVs are opt-in, since CVs are personal data and none are
committed:

```bash
FLASH_CV_FIXTURES=/path/to/pdfs npm test
```

### Testing against a public corpus

Three public corpora of CV pdfs are wired up. Check each licence before
redistributing anything from them.

| name | pdfs | licence | notes |
| --- | --- | --- | --- |
| `opensporks` | 2484 | CC0-1.0 | 64 MB, text-based, contact details redacted |
| `d4rk3r` | 1940 | MIT | 794 MB, heavier real-world layouts |
| `bench` | 38 | CC-BY-4.0 | ships per-field ground truth as jsonl |

```bash
npm run build
bash scripts/fetch-corpus.sh opensporks ./corpus/opensporks
node scripts/check-corpus.mjs ./corpus/opensporks
```

`check-corpus.mjs` reports fill rate per field, quality flags and timings, and
writes the flagged cases to `corpus-failures.txt`. It is the fastest way to
notice that a whole class of pdf is coming out empty — which is exactly how the
uncompressed-stream bug below was found.

Latest run over `opensporks` (2484 pdfs): 0 crashes, 1 pdf with nothing
extracted, name on 100%, experience on 86.6%, skills on 95.3%, median 5.9 ms
per cv. Email and phone land near 0% because that corpus is anonymised, not
because they fail to extract.

### Scoring accuracy against ground truth

`check-corpus` only tells you a field got *filled*. To know whether the value
was *right*, score against the labelled benchmark:

```bash
bash scripts/fetch-corpus.sh bench ./corpus/bench
node scripts/score-bench.mjs ./corpus/bench
```

The benchmark's schema is more structured than ours, so the comparison is
deliberately generous where that is a difference in shape rather than a
failure: it splits the name into fname/lname, splits dates into
start/end month/year, and stores city/state/country separately. Records with no
text layer are reported separately rather than counted as failures, because a
scan cannot be extracted without OCR.

Latest run (10 of the 38 records have a text layer; all 10 are rated `hard`
and are adversarial by design). The "before" column is the first measured
baseline, kept so the direction of travel is visible:

| field | before | now |
| --- | --- | --- |
| email | 100% | **100%** |
| phone | 100% | **100%** |
| name | 90% | **90%** |
| summary | 100% | 88.9% |
| location | 80% | **80%** |
| experience.company (recall) | 49.0% | **77.6%** |
| experience.jobTitle (recall) | 40.8% | **69.4%** |
| education.school (recall) | 40.0% | **55.0%** |
| projects.name (recall) | 50.0% | **78.6%** |
| certifications (recall) | 12.5% | **56.3%** |
| experience start year found | 55.1% | **81.6%** |

What moved the numbers, in order of effect:

- **Bullet lines never start a new entry.** The gap between an entry's header
  block and its first bullet is often wide enough to look like an entry
  boundary, which was splitting one job into three.
- **Ligatures are expanded in the engine.** A serif pdf maps "fi" to a single
  U+FB01 glyph, so "Certiﬁcations" matched neither the keyword `certification`
  nor a letters-only heading test. This one fix moved certifications, headings
  and text quality together.
- **Headings are recognised from type size**, not only from wording and case,
  so "Career Journey" and "Professional Philosophy" are found. It is applied
  additively: a pass that would lose a heading the strict rules found is
  discarded, because in some resumes the entry headers are set at the same size
  as the section headings.
- **Heading vocabulary and priority.** Keywords are matched most-specific
  first, so "Languages" wins over "Skills & Languages".
- **A company is recognised by what a company looks like** — a legal suffix or
  an institution word — and penalised for being an employment type
  ("Full-time"), a field label ("Employer"), or a bare footnote marker.
- **A graduation year no longer cancels a school match**, and ", MA" is no
  longer read as an M.A. degree.
- **Company and job title are resolved in three steps** rather than
  circularly: a provisional title from the gazetteer alone, then the employer
  (which can rule that title out), then the final title (which defers to the
  employer). Each wanted to know what the other was, and resolving them in one
  pass let a bold employer line be reported as both.
- **Word wrapping is undone.** Justified text breaks words at the margin, so a
  pdf yields "compe-" then "tencies". A real compound prefix ("e-" + commerce)
  keeps its hyphen.
- **Headings may carry accents and a parenthesised translation**, and keywords
  are matched with accents folded. A bilingual resume labels its sections
  "Berufserfahrung(Professional Experience)"; rejecting the parentheses and the
  umlaut discarded every heading in the document. This one change moved five
  metrics at once.

Known remaining gaps, measured rather than assumed:

- Certifications are mostly missed because 6 of 7 of those records have **no
  certifications heading at all** — the certificates sit in prose or under
  "Professional Memberships". Where a heading exists, recall is 4/5. Closing
  this needs document-wide entity spotting, not section lookup.
- A heading in a language the keyword lists do not cover and with no
  translation alongside it is still missed. Accent folding handles
  "Expérience"; a bare "Berufserfahrung" would need vocabulary per language.
- The one summary miss returns the candidate's headline rather than the summary
  paragraph.
- Education still loses entries to two causes: a resume laid out as a table,
  where every entry lands in one subsection, and institutions with no
  institution word in the name ("INSEAD", "Sciences Po Paris"), which would
  need a gazetteer or a positional rule.

### Auditing without ground truth

Labels are scarce, but many wrong answers can be detected without them: a
result that contradicts itself, or contradicts the document it came from, is
wrong whatever the ground truth says.

```bash
node scripts/audit-corpus.mjs ./corpus/opensporks
```

The checks are properties any correct extraction must satisfy — the email must
appear in the document, a company must not also be the job title, the name must
not be a section heading, a date must contain a year, no field may contain a
bullet, and no two entries may be identical. Running them over 2484 resumes
found a repeated work entry in **6.4%** of them, which turned out to be one job
split in two with its bullet points divided between the halves. That is now
merged, and the check reports zero.

This is the cheapest way to find a whole class of bug, and it scales to as many
resumes as you can download.

### Holding up on a corpus never tuned against

Numbers on a corpus you tuned against mean little. Measured on 400 pdfs from a
second, independent collection (largely Vietnamese resumes, a font and layout
family absent from everything else here):

| | before | after |
| --- | --- | --- |
| experience filled | 27.8% | **42.0%** |
| education filled | 27.8% | **39.3%** |
| skills filled | 25.8% | **39.8%** |

Self-consistency faults on that same corpus, from `audit-corpus.mjs`:

| | before | after |
| --- | --- | --- |
| name not present in the document | 11.0% | **0%** |
| company not present in the document | 10.5% | **0%** |

Two engine- and vocabulary-level faults accounted for it:

- **Type3 fonts define their own glyph space** through `/FontMatrix`, so their
  `/Widths` are not in thousandths. Assuming 1/1000 made every advance about
  twice too wide, which drove the computed gap between letters negative and lost
  every word boundary on the page: "Sales Account Manager" arrived as
  "SalesAccountManager".
- **Accented text was fragmenting at every diacritic.** Many pdfs set the
  accents in a separate font, and the engine treated a font change as the end of
  an item, so "PHAN VĂN DŨNG" arrived as five pieces. Glyphs that are
  touching now join whatever font they came from, while a font change with a
  real gap still separates a bold label from its value.
- **Heading vocabulary was English only.** Detection was already working --
  "KINH NGHIỆM LÀM VIỆC" and "HỌC VẤN" were found as headings -- but nothing
  mapped them to a field. Accent folding means the keywords can be written
  naturally.

One in five of those pdfs is a photograph with no text layer, and the collection
carries no email addresses at all, so those two figures stay at zero for reasons
that have nothing to do with extraction.

### A note on tuning further

Only 10 of the 38 benchmark records have a text layer, which is a very small
validation set. Every change above was checked against the 2484-pdf corpus as
well, and the contrast is instructive: benchmark company recall moved 49% to
78% while the large corpus barely moved at all. Tuning many more strategies
against 10 records without a holdout would produce a better number rather than
a better parser. More labelled data is the blocker, not technique.

## Layout

```
src/
  index.ts          public api
  types.ts          TextItem in, Cv out
  pipeline.ts       the four steps, wired together
  engine/
    types.ts        the PdfEngine contract
    wasm.ts         loads the rust engine, no glue code
  layout/
    columns.ts      two column detection, reading order
    lines.ts        text items -> lines
    sections.ts     lines -> sections, heading detection
    subsections.ts  a section -> one entry per job/school
    lookup.ts       find a section by keyword
  scoring/
    features.ts     reusable tests: bold, dates, numbers
    score.ts        the feature scoring engine
  text/
    bullets.ts      bullet points -> description lists
  extract/
    profile.ts experience.ts education.ts projects.ts
    skills.ts certifications.ts languages.ts

crates/pdf-core/    the rust engine (see its own README)
```

## Development

```bash
npm install
npm run build:wasm   # cargo -> dist/flash-cv-pdf-core.wasm
npm run build        # wasm + js bundle
npm run check        # typecheck + js tests + rust tests
```

The engine needs the Rust wasm target once:

```bash
rustup target add wasm32-unknown-unknown
```

Tests over real CVs are opt-in, since CVs are personal data and none are
committed:

```bash
FLASH_CV_FIXTURES=/path/to/pdfs npm test
```

### Testing against a public corpus

Three public corpora of CV pdfs are wired up. Check each licence before
redistributing anything from them.

| name | pdfs | licence | notes |
| --- | --- | --- | --- |
| `opensporks` | 2484 | CC0-1.0 | 64 MB, text-based, contact details redacted |
| `d4rk3r` | 1940 | MIT | 794 MB, heavier real-world layouts |
| `bench` | 38 | CC-BY-4.0 | ships per-field ground truth as jsonl |

```bash
npm run build
bash scripts/fetch-corpus.sh opensporks ./corpus/opensporks
node scripts/check-corpus.mjs ./corpus/opensporks
```

`check-corpus.mjs` reports fill rate per field, quality flags and timings, and
writes the flagged cases to `corpus-failures.txt`. It is the fastest way to
notice that a whole class of pdf is coming out empty — which is exactly how the
uncompressed-stream bug below was found.

Latest run over `opensporks` (2484 pdfs): 0 crashes, 1 pdf with nothing
extracted, name on 100%, experience on 86.6%, skills on 95.3%, median 5.9 ms
per cv. Email and phone land near 0% because that corpus is anonymised, not
because they fail to extract.

### Scoring accuracy against ground truth

`check-corpus` only tells you a field got *filled*. To know whether the value
was *right*, score against the labelled benchmark:

```bash
bash scripts/fetch-corpus.sh bench ./corpus/bench
node scripts/score-bench.mjs ./corpus/bench
```

The benchmark's schema is more structured than ours, so the comparison is
deliberately generous where that is a difference in shape rather than a
failure: it splits the name into fname/lname, splits dates into
start/end month/year, and stores city/state/country separately. Records with no
text layer are reported separately rather than counted as failures, because a
scan cannot be extracted without OCR.

Latest run (10 of the 38 records have a text layer; all 10 are rated `hard`
and are adversarial by design):

| field | result |
| --- | --- |
| email | 100% |
| phone | 100% |
| summary | 100% |
| name | 90% |
| location | 80% |
| experience.company (recall) | 49% |
| experience.jobTitle (recall) | 41% |
| education.school (recall) | 40% |
| projects.name (recall) | 50% |
| certifications (recall) | 13% |

Contact extraction is solid; **multi-entry recall is the weak spot**. We return
30 companies where 49 are expected, which means subsections are being
under-split: several jobs merge into one entry. That is the highest-value
thing to fix next, and it lives in `layout/subsections.ts`.

## Limitations

- Targets English language CVs.
- Handles one column, and two columns under an optional full width header.
  Three columns, or a sidebar that changes side partway down, are not detected.
- Scanned or image-only PDFs contain no text to extract; OCR them first.
- Encrypted PDFs are not decrypted.
- A font with no ToUnicode CMap and a non-standard built-in encoding can decode
  wrongly. See [crates/pdf-core/README.md](./crates/pdf-core/README.md) for the
  engine's gaps in full.

## Credits

The extraction heuristics began as [OpenResume](https://github.com/xitanggg/open-resume)'s
resume parser, and remain AGPL-3.0 licensed. The PDF engine, the column
handling and the scoring changes are new.

## License

AGPL-3.0
