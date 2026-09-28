/* Tests for the downloadable packs: every shipped .zip must unzip through the
 * app's own reader (pack.js) and every .gnaural inside must parse through the
 * app's own parser (gnm.js) into exactly the schedule the library generates.
 *
 * Run:  node pack.test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

eval(fs.readFileSync(path.join(__dirname, "engine.js"), "utf8"));
eval(fs.readFileSync(path.join(__dirname, "presets.js"), "utf8"));
eval(fs.readFileSync(path.join(__dirname, "packs.js"), "utf8"));
eval(fs.readFileSync(path.join(__dirname, "gnm.js"), "utf8"));
const Pack = require(path.join(__dirname, "pack.js"));
const GNM = globalThis.GnauralGNM;
const P = globalThis.GnauralPresets;
const K = globalThis.GnauralPacks;

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) pass++; else { fail++; console.log("  FAIL " + label + "  -> " + JSON.stringify(extra)); }
}

const PACKDIR = path.join(__dirname, "pack");
const toAB = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

function near(a, b) { return Math.abs(a - b) <= Math.max(1e-4, Math.abs(b) * 1e-5); }

/* mirrors safeFile() in tools/gnaural_pack.js, so a sanitised filename still
 * matches its library entry ("50/100/288" -> "50-100-288") */
function norm(s) {
  return s.replace(/[\u2013\u2014]/g, "-").replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim();
}

(async function main() {
  const packs = [{ id: "classic", expect: K.LIBRARY.filter(x => x.pack === "classic").length }]
    .concat(K.PACKS.map(p => ({ id: p.id, expect: K.LIBRARY.filter(x => x.pack === p.id).length })));
  packs.push({ id: "gnaural-web-complete", expect: K.LIBRARY.length, complete: true });

  for (const spec of packs) {
    const zipPath = path.join(PACKDIR, spec.id + ".zip");
    check("zip exists: " + spec.id + ".zip", fs.existsSync(zipPath), zipPath);
    if (!fs.existsSync(zipPath)) continue;

    let entries;
    try {
      entries = await Pack.parseZip(toAB(fs.readFileSync(zipPath)));
    } catch (e) {
      check("unzips: " + spec.id, false, e.message);
      continue;
    }
    const gnaurals = entries.filter(e => /\.gnaural$/i.test(e.name));
    const readmes = entries.filter(e => /README\.txt$/i.test(e.name));
    const dirs = new Set(entries.map(e => e.name.replace(/\/[^/]*$/, "")));

    check("unzips: " + spec.id + " (" + entries.length + " entries)", entries.length > 0, entries.length);
    check("has a README: " + spec.id, readmes.length >= 1, readmes.map(r => r.name));
    check("preset count matches the library: " + spec.id, gnaurals.length === spec.expect,
          { inZip: gnaurals.length, expected: spec.expect });
    if (spec.complete) {
      check("complete pack keeps the pack folders", dirs.size >= K.PACKS.length + 1, dirs.size);
    }

    /* every .gnaural in the zip must equal the library's schedule for that name */
    let matched = 0, mismatched = [];
    for (const g of gnaurals) {
      const leaf = g.name.replace(/^.*\//, "").replace(/\.gnaural$/i, "");
      const item = K.LIBRARY.find(x => norm(x.name) === norm(leaf));
      if (!item) { mismatched.push({ leaf, why: "not in library" }); continue; }
      let parsed;
      try {
        parsed = GNM.parseGnaural(new TextDecoder().decode(g.bytes));
      } catch (e) { mismatched.push({ leaf, why: "parse: " + e.message }); continue; }
      const got = GNM.toEngineSchedule(parsed);
      const want = P.presetToSchedule(item);           /* array of voices */
      let same = got.voices.length === want.length;
      if (same) {
        for (let vi = 0; vi < want.length && same; vi++) {
          const a = got.voices[vi].entries, b = want[vi].entries;
          if (a.length !== b.length) { same = false; break; }
          for (let ei = 0; ei < b.length; ei++) {
            if (!near(a[ei].duration, b[ei].duration) || !near(a[ei].volL, b[ei].volL) ||
                !near(a[ei].basefreq, b[ei].basefreq) || !near(a[ei].beat, b[ei].beat)) {
              same = false; mismatched.push({ leaf, voice: vi, entry: ei, got: a[ei], want: b[ei] }); break;
            }
          }
          if (got.voices[vi].type !== want[vi].type) { same = false; mismatched.push({ leaf, why: "type", got: got.voices[vi].type, want: want[vi].type }); }
        }
      } else {
        mismatched.push({ leaf, why: "voice count", got: got.voices.length, want: want.length });
      }
      if (same) matched++;
    }
    check("every preset round-trips exactly: " + spec.id, matched === spec.expect, { matched, mismatched: mismatched.slice(0, 3) });
  }

  /* the library's own invariants that the packs depend on */
  check("library size", K.LIBRARY.length === 15 + K.PACKS.reduce((a, p) => a + p.sessions.length, 0),
        K.LIBRARY.length);
  check("every session has a blurb duration", K.LIBRARY.every(x => / \d+ minutes\.\s*$/.test(x.blurb)), null);

  console.log("packs: " + packs.length + ", library: " + K.LIBRARY.length + " presets");
  console.log(pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
