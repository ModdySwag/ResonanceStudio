/* Node tests for the rate/carrier reference tables (rates.js).
 * Run:  node rates.test.js      (from site/apps/gnaural-web/)
 * The point of these checks is honesty as much as structure: the tables feed
 * the site's help pages, so a claim that creeps in here ships everywhere.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "rates.js"), "utf8");
eval(src);
const R = globalThis.GnauralRates;

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FAIL " + label + (extra !== undefined ? "  -> " + extra : "")); }
}

/* ---------- 1. structure ---------- */
const KINDS = ["binaural", "iso", "tone", "monaural", "pink", "brown", "white"];
const STATUS = ["practice", "physics", "tradition", "source"];
let items = 0, problem = [];
R.GROUPS.forEach(function (g) {
  if (!g.id || !g.name || !g.blurb) problem.push("group " + g.id + " missing fields");
  if (!g.items || !g.items.length) problem.push("group " + g.id + " has no items");
  g.items.forEach(function (it) {
    items++;
    if (typeof it.name !== "string" || !it.name.trim()) problem.push(g.id + ": item without a name");
    if (typeof it.hz !== "number" || !isFinite(it.hz) || it.hz < 0) problem.push(g.id + " / " + it.name + ": bad hz");
    if (KINDS.indexOf(it.kind) === -1) problem.push(g.id + " / " + it.name + ": unknown kind " + it.kind);
    if (STATUS.indexOf(it.status) === -1) problem.push(g.id + " / " + it.name + ": unknown status " + it.status);
    if (typeof it.note !== "string") problem.push(g.id + " / " + it.name + ": note must be a string");
    if (it.kind === "tone" || it.kind === "binaural" || it.kind === "iso" || it.kind === "monaural") {
      if (!(it.hz > 0)) problem.push(g.id + " / " + it.name + ": pitched kinds need a positive rate");
    }
    if (it.kind === "pink" || it.kind === "brown" || it.kind === "white") {
      if (it.hz !== 0) problem.push(g.id + " / " + it.name + ": noise beds carry no rate");
    }
  });
});
check("every table entry is well formed (" + items + " items in " + R.GROUPS.length + " groups)", problem.length === 0, problem.slice(0, 5));

/* ---------- 2. bands ---------- */
check("bandOf maps the named bands correctly",
  R.bandOf(2.5).id === "delta" && R.bandOf(6).id === "theta" && R.bandOf(10).id === "alpha" &&
  R.bandOf(14).id === "smr" && R.bandOf(20).id === "beta" && R.bandOf(40).id === "gamma",
  [2.5, 6, 10, 14, 20, 40].map(function (h) { return R.bandOf(h).id; }));
check("bandOf puts paced-breathing rates below delta, not in it", R.bandOf(0.1).id === "subdelta", R.bandOf(0.1).id);
check("bandOf is total for the useful range", R.bandOf(0.5) && R.bandOf(4) && R.bandOf(12.99) && R.bandOf(99));
check("bandOf rejects nonsense", R.bandOf(0) === null && R.bandOf(-3) === null && R.bandOf(NaN) === null);
check("bands are contiguous (no gaps between them)",
  R.BANDS.every(function (b, i) { return i === 0 || R.BANDS[i - 1].to === b.from; }));

/* ---------- 3. honesty ---------- */
/* Check the DATA, not the file: the header comment intentionally lists the
 * banned phrases as the rule, and must not trip its own guard. */
const dataText = R.GROUPS.map(function (g) {
  return [g.name, g.blurb].concat(g.items.map(function (i) { return i.name + " " + i.note; })).join("\n");
}).join("\n");
const banned = [
  [/\bheals?\b(?!ing[- ]frequenc)/i, "heals/heal"],
  [/\bcures?\b/i, "cure(s)"],
  [/\bentrains? your\b/i, "entrains your (brainwaves)"],
  [/\bimproves? (focus|sleep|memory|concentration)\b/i, "improves focus/sleep/..."],
  [/\bboosts? (memory|immunity|energy)\b/i, "boosts ..."],
  [/\brepairs? your DNA\b/i, "repairs your DNA"],
  [/\bchakra healing\b/i, "chakra healing"],
  [/\braises? your vibration\b/i, "raises your vibration"],
  [/\bdetox(es|ifies|ification)?\b/i, "detox"],
  [/\bdna repair\b(?!.{0,40}(no|not|without|isn't|is not))/i, "DNA repair as a claim"],
  [/\bwill (make you|help you)\b/i, "promise of effect"]
];
const hits = [];
banned.forEach(function (b) {
  const m = dataText.match(b[0]);
  if (m) hits.push(b[1] + " -> " + m[0]);
});
check("no medical or entrainment claims in the tables", hits.length === 0, hits);

/* the word "healing" may only appear as the name of the folk tradition */
const healUses = (dataText.match(/heal[a-z]*/gi) || []);
const badHeal = healUses.filter(function (w) { return !/^healing/i.test(w); });
check("'heal*' appears only in the phrase describing the folk tradition",
  badHeal.length === 0, badHeal);
check("the banned-phrase guard has teeth (probes itself)",
  /heals/.test("This tone heals you") && banned[0][0].test("This tone heals you") === true &&
  banned[0][0].test("a healing frequencies tradition") === false);

check("the solfeggio group states its provenance (1990s, Puleo/Horowitz)",
  /Puleo/.test(R.GROUPS.find(function (g) { return g.id === "solffeggio"; }).blurb));
check("the Schumann group states the resonances are electromagnetic",
  /electromagnetic/i.test(R.GROUPS.find(function (g) { return g.id === "schumann"; }).blurb));
check("the focus group states no affiliation with the Monroe Institute",
  /no affiliation/i.test(R.GROUPS.find(function (g) { return g.id === "focus"; }).blurb));
check("the 40 Hz gamma entry states the research used light and clicks",
  /light and clicks/i.test(R.byName("Gamma-range (40 Hz)").note));
check("the 528 Hz entry flags the DNA claim as unsupported",
  /no peer-reviewed support/i.test(R.GROUPS.find(function (g) { return g.id === "solffeggio"; }).blurb));
check("every group blurb is a real sentence, not a placeholder",
  R.GROUPS.every(function (g) { return g.blurb.length > 60 && /[.!]/.test(g.blurb); }));

/* ---------- 4. lookups ---------- */
check("find('iso') returns only iso entries",
  R.find("iso").length > 0 && R.find("iso").every(function (i) { return i.kind === "iso"; }));
check("find() with no argument returns everything",
  R.find().length === items, R.find().length);
check("byName finds an entry and returns null otherwise",
  R.byName("528 Hz") && R.byName("528 Hz").hz === 528 && R.byName("nope") === null);
check("the dedicated 0.1 Hz breathing entry exists",
  R.find().some(function (i) { return i.hz === 0.1 && /6 breaths/.test(i.name); }));

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
