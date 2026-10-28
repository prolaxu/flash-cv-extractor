// Run the extractor over a directory of cv pdfs and report fill rates,
// quality flags and timings. Useful for spotting a whole class of pdf that
// comes out empty.
//
//   npm run build
//   node scripts/check-corpus.mjs /path/to/pdfs
//
import fs from "node:fs";
import path from "node:path";
import { extractCv, createWasmEngine } from "../dist/index.js";

const dir = process.argv[2];
const engine = createWasmEngine("dist/flash-cv-pdf-core.wasm");
const files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith(".pdf")).sort();

const stat = { total: 0, threw: 0, noText: 0, name: 0, email: 0, phone: 0,
               location: 0, url: 0, exp: 0, edu: 0, proj: 0, skills: 0,
               certs: 0, langs: 0, badEmail: 0, badName: 0 };
const failures = [];
const times = [];

for (const f of files) {
  stat.total++;
  const bytes = new Uint8Array(fs.readFileSync(path.join(dir, f)));
  try {
    const t0 = performance.now();
    const cv = await extractCv(bytes, { engine });
    times.push(performance.now() - t0);
    const p = cv.profile;
    if (p.name) stat.name++;
    if (p.email) stat.email++;
    if (p.phone) stat.phone++;
    if (p.location) stat.location++;
    if (p.url) stat.url++;
    if (cv.experience.length) stat.exp++;
    if (cv.education.length) stat.edu++;
    if (cv.projects.length) stat.proj++;
    if (cv.skills.descriptions.length) stat.skills++;
    if (cv.certifications.length) stat.certs++;
    if (cv.languages.length) stat.langs++;
    // quality checks
    if (p.email && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(p.email)) { stat.badEmail++; failures.push(`${f}: email=${JSON.stringify(p.email)}`); }
    if (p.name && (/[@/]|\d/.test(p.name) || p.name.length > 50)) { stat.badName++; failures.push(`${f}: name=${JSON.stringify(p.name)}`); }
    if (!p.name && !p.email && !p.phone) { stat.noText++; failures.push(`${f}: nothing extracted`); }
  } catch (e) {
    stat.threw++;
    failures.push(`${f}: THREW ${e.message}`);
  }
}

times.sort((a,b)=>a-b);
const pct = (n) => `${(100*n/stat.total).toFixed(1)}%`;
console.log(`\ncorpus: ${stat.total} pdfs`);
console.log(`crashed              : ${stat.threw} (${pct(stat.threw)})`);
console.log(`nothing extracted    : ${stat.noText} (${pct(stat.noText)})`);
console.log(`\nfield fill rate:`);
for (const k of ["name","email","phone","location","url","exp","edu","proj","skills","certs","langs"])
  console.log(`  ${k.padEnd(10)} ${String(stat[k]).padStart(5)}  ${pct(stat[k])}`);
console.log(`\nquality flags:`);
console.log(`  malformed email  : ${stat.badEmail} (${pct(stat.badEmail)})`);
console.log(`  implausible name : ${stat.badName} (${pct(stat.badName)})`);
console.log(`\nspeed: median ${times[Math.floor(times.length/2)].toFixed(1)}ms  p95 ${times[Math.floor(times.length*0.95)].toFixed(1)}ms  max ${times[times.length-1].toFixed(1)}ms`);
console.log(`total wall: ${(times.reduce((a,b)=>a+b,0)/1000).toFixed(1)}s for ${times.length} cvs`);
fs.writeFileSync("corpus-failures.txt", failures.join("\n"));
console.log(`\n${failures.length} flagged cases -> corpus-failures.txt`);
