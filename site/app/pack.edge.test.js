/* Adversarial tests for the .zip reader in pack.js — malformed and hostile packs.
 *
 * Run:  node pack.edge.test.js
 *
 * Style matches pack.test.js: plain asserts via check(), no framework, exit 1 on
 * failure.  Fixtures are built in memory with Buffer/zlib (Node builtins only —
 * zlib is used purely to *produce* honest deflate streams; nothing is added to
 * the shipped page).  The real shipped pack/pack/wave1.zip is used as the
 * mutation baseline.
 *
 * Observable contract asserted per case: an exact reader Error message
 * ("throws a specific error") or an exact entry list ("returns entries") —
 * never merely "does not crash".
 *
 * ---------------------------------------------------------------------------
 * DEFECTS FOUND BY THIS FILE — ALL FOUR NOW FIXED in pack.js (hardened
 * revision: bounds helper `need()`, EOCD validated against EOF, streaming
 * budget, wrapped inflate).  Kept here as the record of what was wrong; the
 * checks below are the regression tests.
 *
 *  1. [11] hostile offsets leaked raw DataView/typed-array RangeErrors instead
 *     of reader diagnostics (CD lho 0xFFFFFFFF/0x7FFFFFF0, nameLen past EOF,
 *     cdOff in the last 3 bytes, wave1.zip cut mid-CD).
 *     Fixed: every read is bounds-checked via need() and reports
 *     "damaged zip (bad central directory entry)" / "(bad local header for X)".
 *
 *  2. [8] declared usize was never verified against the real inflated size, so
 *     MAX_FILE_BYTES (8 MiB) was only a declaration check and was bypassable:
 *     a 9 MiB payload declaring usize=64 (~1014x) was accepted and handed to the
 *     caller, and a single entry could force huge allocation before
 *     MAX_TOTAL_BYTES fired after the fact.
 *     Fixed: inflate() counts REAL bytes and stops at the budget mid-stream;
 *     the real size is checked against MAX_FILE_BYTES too.  An under-claimed
 *     usize is still returned truthfully (asserted below) — the declared field
 *     is not a contract, the byte count is.
 *
 *  3. [13] a corrupt/truncated compressed payload leaked a bare TypeError whose
 *     message is EMPTY (Node 26: "TypeError: " from node:internal/webstreams/
 *     adapters; browsers likewise report e.g. "Failed to fetch"), so the app's
 *     error toast read "Could not read pack: " with no explanation.
 *     Fixed: the inflate pipeline is wrapped; the caller now sees
 *     "damaged zip (<name> has corrupt compressed data)".
 *
 *  4. [12] findEOCD accepted the LAST EOCD signature in the file without
 *     checking that record+comment reaches EOF, so an archive comment
 *     containing that signature steered the parse: a 2-entry pack whose comment
 *     held a fake EOCD (count=1) silently returned 1 entry — content
 *     substitution / silent omission, no error.
 *     Fixed: a candidate is trusted only when eocd + 22 + u16(eocd+20) === len,
 *     walking back otherwise.  Consequence: comment bytes are now simply
 *     ignored, so the sibling check that used to demand a BADCD rejection for a
 *     valid 2-entry archive with an EOCD-shaped comment now asserts both
 *     entries parse — that rejection was the old bug's behaviour, not the
 *     contract.
 * ---------------------------------------------------------------------------
 *
 * CASE 5 (../ and ..\\ traversal) — informational, nothing crashes: the reader
 * returns names verbatim, unsanitised (asserted below).  The current caller
 * (app.js loadPackZip) only regex-filters names for /\.gnaural$/ and shows
 * `e.name.replace(/^.*\//,"")` as an in-memory label; entry names never reach a
 * filesystem path (no File System Access API, no writable stream; the WAV export
 * name comes from the preset title, sanitised at app.js:52).  So traversal is
 * NOT exploitable here — but any future "extract to disk" caller would have to
 * sanitise first: reject absolute paths and drive letters, drop ".." segments,
 * and treat both "/" and "\\" as separators (and reject NUL, which the reader
 * also passes through untouched).
 */
"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");           /* Node builtin, fixtures only */

const Pack = require(path.join(__dirname, "pack.js"));

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; if (process.env.EDGE_VERBOSE) console.log("  ok   " + label); }
  else { fail++; console.log("  FAIL " + label + "  -> " + JSON.stringify(extra)); }
}

const DIR = __dirname;
const REAL_PATH = path.join(DIR, "pack", "wave1.zip");
const toAB = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const abort = (e) => (e && e.message) || String(e);

/* the reader's own diagnostics — every hostile input should surface as one of
 * these, never as a raw DataView/typed-array/stream error */
const DIAG = /^(not a zip file \(no end-of-directory record\)|zip64 archives are not supported|damaged zip \(.+\)|too many files in this pack|.+ is too large for a preset pack|pack is too large|unsupported compression method \d+)$/;

/* ------------------------------------------------------------------ fixtures */
/* a minimal, spec-correct zip writer so hostile inputs differ from honest ones
 * only in the field under test (verified: these archives open in Python's
 * zipfile and `unzip -t`) */
const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crc32(buf) {
  let c = -1 >>> 0;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function localHeader(name, method, csize, usize, crc, extra) {
  const nb = Buffer.from(name, "utf8"), ex = extra || Buffer.alloc(0), b = Buffer.alloc(30);
  b.writeUInt32LE(0x04034b50, 0);
  b.writeUInt16LE(20, 4);                       /* version needed */
  b.writeUInt16LE(0, 6);                        /* flags */
  b.writeUInt16LE(method, 8);
  b.writeUInt32LE(crc >>> 0, 14);
  b.writeUInt32LE(csize >>> 0, 18);
  b.writeUInt32LE(usize >>> 0, 22);
  b.writeUInt16LE(nb.length, 26);
  b.writeUInt16LE(ex.length, 28);
  return Buffer.concat([b, nb, ex]);
}
function cdEntry(e) {
  const nb = Buffer.from(e.name, "utf8"), ex = e.extra || Buffer.alloc(0), cm = e.comment || Buffer.alloc(0);
  const b = Buffer.alloc(46);
  b.writeUInt32LE(0x02014b50, 0);
  b.writeUInt16LE(20, 4); b.writeUInt16LE(20, 6);
  b.writeUInt16LE(e.flags || 0, 8);
  b.writeUInt16LE(e.method, 10);
  b.writeUInt32LE(e.crc >>> 0, 16);
  b.writeUInt32LE(e.csize >>> 0, 20);
  b.writeUInt32LE(e.usize >>> 0, 24);
  b.writeUInt16LE(nb.length, 28); b.writeUInt16LE(ex.length, 30); b.writeUInt16LE(cm.length, 32);
  b.writeUInt16LE(0, 34); b.writeUInt16LE(0, 36);
  b.writeUInt32LE(0, 38);
  b.writeUInt32LE(e.lho >>> 0, 42);
  return Buffer.concat([b, nb, ex, cm]);
}
function eocdRec(count, cdSize, cdOff, comment) {
  const cm = comment || Buffer.alloc(0), b = Buffer.alloc(22);
  b.writeUInt32LE(0x06054b50, 0);
  b.writeUInt16LE(0, 4); b.writeUInt16LE(0, 6);
  b.writeUInt16LE(count & 0xffff, 8); b.writeUInt16LE(count & 0xffff, 10);
  b.writeUInt32LE(cdSize >>> 0, 12);
  b.writeUInt32LE(cdOff >>> 0, 16);
  b.writeUInt16LE(cm.length, 20);
  return Buffer.concat([b, cm]);
}
/* entry: {name, data, method, usize/csize/lho overrides, lextra/cextra/ccomment,
 *         flags, payload override}.  Returns {buf, cdOff, cdSize, eocdAt}. */
function mkZipEx(entries, opt) {
  opt = opt || {};
  const parts = [], cds = [];
  for (const e of entries) {
    const here = parts.reduce((a, p) => a + p.length, 0);
    let raw, usize;
    if (e.data === undefined) { raw = Buffer.alloc(0); usize = 0; }
    else if (e.method === 8) { raw = zlib.deflateRawSync(e.data, { level: 9 }); usize = e.data.length; }
    else { raw = e.data; usize = e.data.length; }
    if (e.payload) raw = e.payload;
    const csize = e.csize !== undefined ? e.csize : raw.length;
    const declU = e.usize !== undefined ? e.usize : usize;
    const crc = e.crc !== undefined ? e.crc : (e.data ? crc32(e.data) : 0);
    parts.push(localHeader(e.name, e.method, csize, declU, crc, e.lextra), raw);
    cds.push(cdEntry({ name: e.name, method: e.method, csize, usize: declU, crc,
                       lho: e.lho !== undefined ? e.lho : here, flags: e.flags,
                       extra: e.cextra, comment: e.ccomment }));
  }
  const cd = Buffer.concat(cds);
  const cdOff = parts.reduce((a, p) => a + p.length, 0);
  parts.push(cd);
  const eocdAt = parts.reduce((a, p) => a + p.length, 0);
  parts.push(eocdRec(opt.count !== undefined ? opt.count : entries.length,
                     opt.cdSize !== undefined ? opt.cdSize : cd.length,
                     opt.cdOff !== undefined ? opt.cdOff : cdOff, opt.comment));
  return { buf: Buffer.concat(parts), cdOff, cdSize: cd.length, eocdAt };
}
const mkZip = (entries, opt) => mkZipEx(entries, opt).buf;

/* independent scan of a zip's central directory — used to prove each fixture
 * really contains what the test claims (guards against vacuous passes) and to
 * derive mutation offsets from whatever pack/wave1.zip currently ships, so the
 * suite stays deterministic when the generated packs are rebuilt */
function scanCD(buf) {
  let at = -1;
  for (let i = buf.length - 22; i >= 0; i--) if (buf.readUInt32LE(i) === 0x06054b50) { at = i; break; }
  if (at < 0) return null;
  const count = buf.readUInt16LE(at + 10), cdOff = buf.readUInt32LE(at + 16), cdSize = buf.readUInt32LE(at + 12);
  let p = cdOff, files = 0, dirs = 0, n = 0;
  const fileNames = [], dirNames = [];
  for (let i = 0; i < count && p + 46 <= buf.length; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), cmtLen = buf.readUInt16LE(p + 32);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString("utf8");
    if (/\/$/.test(name)) { dirs++; dirNames.push(name); } else { files++; fileNames.push(name); }
    n++;
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return { eocdAt: at, count, cdOff, cdSize, files, dirs, walked: n, fileNames, dirNames };
}

/* ------------------------------------------------------------------ runners */
let parses = 0;                          /* every parseZip() call, for the footer */
async function attempt(buf) {
  parses++;
  try { return { threw: false, entries: await Pack.parseZip(toAB(buf)) }; }
  catch (e) { return { threw: true, err: e }; }
}
async function expectThrow(label, buf, wantMsg) {
  const r = await attempt(buf);
  check(label, r.threw && r.err instanceof Error && r.err.message === wantMsg,
        r.threw ? { got: r.err.constructor.name + ": " + r.err.message, want: wantMsg }
                : { got: "returned " + r.entries.length + " entries", want: wantMsg });
  return r;
}
async function expectOk(label, buf, n, names) {
  const r = await attempt(buf);
  const ok = !r.threw && r.entries.length === n && (names === undefined || names.every((x, i) => r.entries[i].name === x));
  check(label, ok, r.threw ? { threw: r.err.constructor.name + ": " + abort(r.err.message) }
                           : { got: r.entries.map(x => x.name), want: names === undefined ? n : { n, names } });
  return r;
}

(async function main() {
  const real = fs.readFileSync(REAL_PATH);
  /* Everything derived from the shipped pack is computed at run time: the packs
   * in pack/ are generated artifacts and get rebuilt, so no entry count, offset
   * or size here may be hard-coded. */
  const rc = scanCD(real);
  if (!rc || !rc.count || rc.walked !== rc.count || rc.cdOff + rc.cdSize !== rc.eocdAt) {
    throw new Error("fixture: pack/wave1.zip is not a readable zip (scanCD -> " + JSON.stringify(rc && { count: rc.count, walked: rc.walked, cdOff: rc.cdOff, cdSize: rc.cdSize, eocdAt: rc.eocdAt }) + ")");
  }
  const DC = rc.eocdAt + 10;                       /* EOCD total-entries field offset */
  const CDOFF = rc.eocdAt + 16;                    /* EOCD central-directory offset field */
  const bump = (n) => { const b = Buffer.from(real); b.writeUInt16LE(n, DC - 2); b.writeUInt16LE(n, DC); return b; };

  /* ---------------------------------------------------------- 0. baseline */
  const base = await attempt(real);
  check("0. baseline: pack/wave1.zip (" + real.length + " bytes, " + rc.files + " files) parses",
        !base.threw && base.entries.length === rc.files && rc.count === rc.files + rc.dirs,
        base.threw ? { threw: base.err.message } : { got: base.entries.length, cdFiles: rc.files, cdTotal: rc.count });
  check("0. baseline: parsed names match an independent scan of the central directory",
        !base.threw && base.entries.map(e => e.name).join("\n") === rc.fileNames.join("\n"),
        base.threw ? { threw: base.err.message } : { got: base.entries.map(e => e.name), want: rc.fileNames });
  check("0. baseline: every parsed entry has non-empty bytes and a README is present",
        !base.threw && base.entries.every(e => e.bytes.length > 0) && base.entries.some(e => /README\.txt$/.test(e.name)),
        base.threw ? { threw: base.err.message } : base.entries.map(e => e.name + ":" + e.bytes.length));

  /* --------------------------------------- 1. empty file / not a zip at all */
  const NOTZIP = "not a zip file (no end-of-directory record)";
  await expectThrow("1. 0-byte file is rejected as 'not a zip file'", Buffer.alloc(0), NOTZIP);
  await expectThrow("1. 1-byte file is rejected as 'not a zip file'", Buffer.from("A"), NOTZIP);
  await expectThrow("1. 21-byte file is rejected as 'not a zip file'", Buffer.alloc(21, 0x41), NOTZIP);
  await expectThrow("1. 22 bytes of text is rejected as 'not a zip file'", Buffer.alloc(22, 0x41), NOTZIP);
  await expectThrow("1. 200 bytes of non-zip text is rejected as 'not a zip file'",
                    Buffer.from("GNAURAL-PACK-PLACEHOLDER-".repeat(10)), NOTZIP);
  await expectOk("1. bare EOCD signature = legal empty archive ([] entries)",
                 Buffer.concat([Buffer.from([0x50, 0x4b, 0x05, 0x06]), Buffer.alloc(18)]), 0);
  await expectThrow("1. EOCD signature + garbage tail is rejected",
                    Buffer.concat([Buffer.from([0x50, 0x4b, 0x05, 0x06]), Buffer.from("garbagegarbagegarbage")]),
                    "damaged zip (central directory outside file)");

  /* --------------------------------------------- 2. truncation of structures */
  check("2. fixture self-check: the tail-cut archive really holds no EOCD signature",
        (() => { const t = real.slice(0, rc.eocdAt); for (let i = t.length - 22; i >= 0; i--) if (t.readUInt32LE(i) === 0x06054b50) return false; return true; })(), rc.eocdAt);
  await expectThrow("2. wave1 with its tail cut off (no EOCD) is rejected",
                    real.slice(0, rc.eocdAt), NOTZIP);
  await expectThrow("2. wave1's EOCD alone (central directory gone) is rejected",
                    real.slice(rc.eocdAt), "damaged zip (central directory outside file)");
  await expectThrow("2. head + EOCD (central directory gone) is rejected",
                    Buffer.concat([real.slice(0, 100), real.slice(rc.eocdAt)]),
                    "damaged zip (central directory outside file)");
  await expectThrow("2. cdOff pointing one byte before the real central directory is rejected",
                    (() => { const b = Buffer.from(real); b.writeUInt32LE(rc.cdOff - 1, CDOFF); return b; })(),
                    "damaged zip (bad central directory entry)");
  /* truncated local header: the header's own lengths now run past EOF */
  await expectThrow("2. local header with nameLen/extraLen past EOF is rejected",
                    (() => { const b = Buffer.from(mkZip([{ name: "a.gnaural", data: Buffer.from("abc"), method: 0 }]));
                             b.writeUInt16LE(65535, 26); b.writeUInt16LE(65535, 28); return b; })(),
                    "damaged zip (a.gnaural runs past the end)");
  await expectThrow("2. CD lho pointing at a non-local-header offset is rejected",
                    mkZip([{ name: "a.gnaural", data: Buffer.from("abc"), method: 0, lho: 4 }]),
                    "damaged zip (bad local header for a.gnaural)");
  await expectThrow("2. CD csize running past EOF is rejected",
                    mkZip([{ name: "a.gnaural", data: Buffer.from("abc"), method: 0, csize: 0x10000 }]),
                    "damaged zip (a.gnaural runs past the end)");

  /* -------------------------------- 3. EOCD file count vs entries really present */
  const BADCD = "damaged zip (bad central directory entry)";
  await expectThrow("3. count=" + (rc.count + 1) + " with " + rc.count + " entries present is rejected", bump(rc.count + 1), BADCD);
  await expectThrow("3. count=400 with " + rc.count + " entries present is rejected", bump(400), BADCD);
  await expectThrow("3. count=65534 with " + rc.count + " entries present is rejected", bump(65534), BADCD);
  await expectThrow("3. count=2 with 1 entry present is rejected",
                    mkZip([{ name: "a.txt", data: Buffer.from("A"), method: 0 }], { count: 2 }), BADCD);
  /* under-claim: the EOCD count is authoritative, so 0 yields an empty pack.
   * Documented behaviour (no silent garbage), not a defect — but a corrupt pack
   * then looks to the caller like a pack with no presets at all. */
  await expectOk("3. count=0 with " + rc.count + " entries present returns [] (EOCD count is authoritative)", bump(0), 0);

  /* ------------------------------------------------------------ 4. zip64 markers */
  const Z64 = "zip64 archives are not supported";
  await expectThrow("4. zip64 EOCD count 0xFFFF is rejected with the zip64 message", bump(0xffff), Z64);
  await expectThrow("4. zip64 EOCD cdOff 0xFFFFFFFF is rejected with the zip64 message",
                    (() => { const b = Buffer.from(real); b.writeUInt32LE(0xFFFFFFFF, CDOFF); return b; })(), Z64);
  const z64extra = (() => { const x = Buffer.alloc(20); x.writeUInt16LE(0x0001, 0); x.writeUInt16LE(16, 2); return x; })();
  /* per-entry 0xFFFFFFFF placeholders: rejected (never silently mis-parsed) —
   * see section 11 for the message-quality defect on the lho case */
  const z64u = await attempt(mkZip([{ name: "a.txt", data: Buffer.from("A"), method: 0, usize: 0xFFFFFFFF, cextra: z64extra }]));
  check("4. CD usize 0xFFFFFFFF (with zip64 extra) is rejected", z64u.threw && z64u.err instanceof Error && z64u.err.message === "a.txt is too large for a preset pack",
        z64u.threw ? { got: z64u.err.message } : { got: z64u.entries.length });
  const z64c = await attempt(mkZip([{ name: "a.txt", data: Buffer.from("A"), method: 0, csize: 0xFFFFFFFF }]));
  check("4. CD csize 0xFFFFFFFF is rejected", z64c.threw && z64c.err.message === "damaged zip (a.txt runs past the end)",
        z64c.threw ? { got: z64c.err.message } : { got: z64c.entries.length });
  const z64l = await attempt(mkZip([{ name: "a.txt", data: Buffer.from("A"), method: 0, lho: 0xFFFFFFFF }]));
  check("4. CD lho 0xFFFFFFFF (zip64 marker) is rejected, not mis-parsed", z64l.threw,
        z64l.threw ? { got: z64l.err.constructor.name + ": " + z64l.err.message } : { got: z64l.entries.map(e => e.name) });
  await expectOk("4. zip64 extra field with honest 32-bit sizes is ignored (parses)",
                 mkZip([{ name: "a.txt", data: Buffer.from("A"), method: 0, cextra: z64extra }]), 1);
  await expectOk("4. archive carrying a zip64 locator but honest EOCD parses",
                 (() => { const z = mkZip([{ name: "a.txt", data: Buffer.from("A"), method: 0 }]);
                          const loc = Buffer.alloc(20); loc.writeUInt32LE(0x07064b50, 0);
                          return Buffer.concat([z.slice(0, z.length - 22), loc, z.slice(z.length - 22)]); })(), 1);

  /* --------------------------------------- 5. path traversal in entry names */
  const HOSTILE_NAMES = ["../../../evil.gnaural", "..\\..\\win-evil.gnaural", "/etc/passwd",
                         "C:\\Windows\\evil.gnaural", "wave1/a/../../b.gnaural", "\u0000null.gnaural", "normal.gnaural"];
  const trav = await expectOk("5. traversal names are returned verbatim (no crash)", mkZip(
    HOSTILE_NAMES.map((n, i) => ({ name: n, data: Buffer.from(String(i)), method: 0 }))), 7, HOSTILE_NAMES);
  check("5. traversal: the reader does NOT sanitise/normalise names (caller's job)",
        !trav.threw && trav.entries.every((e, i) => e.name === HOSTILE_NAMES[i]),
        trav.threw ? { threw: trav.err.message } : trav.entries.map(e => e.name));
  check("5. traversal: ../names do not change the returned payload bytes",
        !trav.threw && trav.entries[0].bytes.length === 1 && trav.entries[0].bytes[0] === 48 /* "0" */,
        trav.threw ? { threw: trav.err.message } : trav.entries.slice(0, 1).map(e => e.bytes.length));
  check("5. traversal: a NUL byte in a name survives untouched (would need rejecting before any disk write)",
        !trav.threw && trav.entries[5].name === "\u0000null.gnaural",
        trav.threw ? { threw: trav.err.message } : trav.entries[5] && trav.entries[5].name);

  /* -------------------------------------------- 6. stored (0) vs deflate (8) */
  const storedBytes = Buffer.alloc(300, 7), deflateBytes = Buffer.alloc(300, 9);
  const mixed = await expectOk("6. stored + deflate entries both parse, in order",
    mkZip([{ name: "stored.bin", data: storedBytes, method: 0 },
           { name: "deflated.bin", data: deflateBytes, method: 8 },
           { name: "empty-stored.bin", data: Buffer.alloc(0), method: 0 }]),
    3, ["stored.bin", "deflated.bin", "empty-stored.bin"]);
  check("6. stored entry bytes are exact",
        !mixed.threw && Buffer.compare(Buffer.from(mixed.entries[0].bytes), storedBytes) === 0,
        mixed.threw ? { threw: mixed.err.message } : mixed.entries[0] && mixed.entries[0].bytes.length);
  check("6. deflate entry bytes are exact (real inflate, not a passthrough)",
        !mixed.threw && Buffer.compare(Buffer.from(mixed.entries[1].bytes), deflateBytes) === 0,
        mixed.threw ? { threw: mixed.err.message } : mixed.entries[1] && mixed.entries[1].bytes.length);
  check("6. 0-byte stored entry parses to 0 bytes",
        !mixed.threw && mixed.entries[2].bytes.length === 0,
        mixed.threw ? { threw: mixed.err.message } : mixed.entries[2] && mixed.entries[2].bytes.length);
  const lie = await expectOk("6. stored entry with a lying usize returns csize bytes (usize is not trusted for reads)",
    mkZip([{ name: "lie.bin", data: Buffer.alloc(3, 1), method: 0, usize: 99 }]), 1);
  check("6. stored lying usize -> exactly 3 bytes (declared 99 ignored)",
        !lie.threw && lie.entries[0].bytes.length === 3,
        lie.threw ? { threw: lie.err.message } : lie.entries[0] && lie.entries[0].bytes.length);
  await expectOk("6. flag bit 3 (data descriptor) accepted: sizes come from the CD",
                 mkZip([{ name: "dd.bin", data: Buffer.alloc(50, 3), method: 8, flags: 0x08, lextra: Buffer.alloc(16) },
                        { name: "dd0.bin", data: Buffer.alloc(50, 4), method: 0, flags: 0x08 }]), 2);

  /* --------------------------------------------- 7. unsupported methods */
  for (const m of [1, 6, 9, 12, 14, 20, 99, 65535]) {
    await expectThrow("7. compression method " + m + " rejected with 'unsupported compression method " + m + "'",
                      mkZip([{ name: "m" + m + ".bin", data: Buffer.from("hello world"), method: m }]),
                      "unsupported compression method " + m);
  }

  /* ------------------------------------------- 8. declared vs real entry sizes */
  const MiB = 1024 * 1024;
  const twoMiB = Buffer.alloc(2 * MiB, 0);
  const big = await expectOk("8. honest 2 MiB deflated file still parses", mkZip([{ name: "big.gnaural", data: twoMiB, method: 8 }]), 1);
  check("8. honest 2 MiB file inflates to exactly 2 MiB of zeros",
        !big.threw && big.entries[0].bytes.length === 2 * MiB && big.entries[0].bytes.every(x => x === 0),
        big.threw ? { threw: big.err.message } : big.entries[0] && big.entries[0].bytes.length);
  await expectOk("8. declared usize == MAX_FILE_BYTES (8 MiB) is accepted (boundary)",
                 mkZip([{ name: "exact.gnaural", data: Buffer.alloc(8 * MiB, 0), method: 8 }]), 1);
  await expectThrow("8. declared usize 8 MiB + 1 is rejected as too large",
                    mkZip([{ name: "over.gnaural", data: Buffer.alloc(4), method: 0, usize: 8 * MiB + 1 }]),
                    "over.gnaural is too large for a preset pack");

  /* DEFECT 2: the real inflated size is never compared with usize or
   * MAX_FILE_BYTES (pack.js checks the *declared* usize at line 67, then only
   * the running total at lines 73-75, after inflate returned the whole buffer).
   * The entry below really holds 9 MiB while declaring 64 bytes (9.3 KB on
   * disk, measured ~1014x expansion), so an oversized entry is handed back to
   * the caller instead of being rejected. */
  const bomb9 = mkZip([{ name: "bomb.gnaural", data: Buffer.alloc(9 * MiB, 0), method: 8, usize: 64 }]);
  const b9 = await attempt(bomb9);
  check("8. an entry whose REAL inflated size exceeds MAX_FILE_BYTES is rejected (declared usize lies)",
        b9.threw,
        { "9 MiB payload declared as 64 B": b9.threw ? b9.err.message : "ACCEPTED " + b9.entries[0].bytes.length + " bytes",
          inputBytes: bomb9.length, amplification: +(9 * MiB / bomb9.length).toFixed(1) + "x", cap: 8 * MiB });
  /* same root cause, no cap crossed: usize is not a verified contract at all —
   * an under-claiming usize changes nothing about what the caller receives */
  const bomb1 = mkZip([{ name: "bomb.gnaural", data: Buffer.alloc(1 * MiB, 0), method: 8, usize: 1024 }]);
  const b1 = await attempt(bomb1);
  check("8. usize is not verified: an under-claimed usize still returns the real bytes (documented behaviour)",
        !b1.threw && b1.entries[0].bytes.length === 1 * MiB,
        b1.threw ? { threw: b1.err.message } : b1.entries.map(e => e.bytes.length));
  /* MAX_TOTAL_BYTES does bound the *sum* — but only after each entry is fully
   * inflated (pack.js:73-75), so the overshoot is one whole entry: a ~1 MB
   * hostile pack can drive ~1 GB of allocation in the tab before this fires. */
  await expectThrow("8. a single 40 MiB entry (declared usize=1) trips MAX_TOTAL_BYTES",
                    mkZip([{ name: "bomb2.gnaural", data: Buffer.alloc(40 * MiB, 0), method: 8, usize: 1 }]),
                    "pack is too large");
  await expectThrow("8. 5 x 8 MiB honest entries (40 MiB) trip MAX_TOTAL_BYTES",
                    mkZip(Array.from({ length: 5 }, (_, i) => ({ name: "big" + i + ".gnaural", data: Buffer.alloc(8 * MiB, 0), method: 8 }))),
                    "pack is too large");

  /* ------------------------------------------------------- 9. too many files */
  const many = (n, dirs) => mkZip(Array.from({ length: n }, (_, i) => ({ name: "f" + String(i).padStart(3, "0") + ".gnaural", data: Buffer.from("x"), method: 0 }))
    .concat(Array.from({ length: dirs || 0 }, (_, i) => ({ name: "d" + i + "/", method: 0 }))));
  const m400 = many(400), m401 = many(401), m400d = many(400, 5);
  check("9. fixture self-check: the 401-entry archive really has 401 CD entries",
        (scanCD(m401) || {}).files === 401, scanCD(m401));
  check("9. fixture self-check: the 400-file archive has 400 files + 5 directories",
        (scanCD(m400d) || {}).files === 400 && (scanCD(m400d) || {}).dirs === 5, scanCD(m400d));
  await expectOk("9. exactly MAX_FILES (400) files is accepted (boundary)", m400, 400);
  await expectThrow("9. 401 files is rejected as 'too many files in this pack'", m401, "too many files in this pack");
  await expectOk("9. 400 files + 5 directory entries is accepted (directory entries are not files)", m400d, 400);
  await expectThrow("9. 401 files + 5 directory entries is still rejected", many(401, 5), "too many files in this pack");

  /* --------------------------------------- 10. zero-byte entries and directories */
  const z8 = await expectOk("10. 0-byte .gnaural (deflated) parses to one 0-byte entry",
                            mkZip([{ name: "empty.gnaural", data: Buffer.alloc(0), method: 8 }]), 1);
  check("10. 0-byte deflated entry -> exactly 0 bytes",
        !z8.threw && z8.entries[0].bytes.length === 0,
        z8.threw ? { threw: z8.err.message } : z8.entries[0] && z8.entries[0].bytes.length);
  await expectOk("10. 0-byte .gnaural (stored) parses to one 0-byte entry",
                 mkZip([{ name: "empty.gnaural", data: Buffer.alloc(0), method: 0 }]), 1);
  await expectOk("10. directory-only zip returns [] (no files at all)",
                 mkZip([{ name: "wave1/", method: 0 }, { name: "wave1/sub/", method: 0 }]), 0);
  await expectThrow("10. directory-only zip with an over-claimed count is rejected",
                    mkZip([{ name: "d/", method: 0 }], { count: 3 }), BADCD);
  await expectOk("10. a '/' entry is skipped before method/lho are examined (hostile dir entry is harmless)",
                 mkZip([{ name: "d/", method: 99, lho: 0xFFFFFFFF, usize: 0xFFFFFFFF, csize: 0xFFFFFFFF }]), 0);

  /* ---------------------- 11. bounds: hostile offsets must not leak raw errors */
  /* the real-zip input cuts the central directory 5 bytes in, i.e. strictly
   * mid-entry for any wave1.zip the generator ships */
  const cut = Buffer.concat([real.slice(0, rc.cdOff + 5), real.slice(rc.eocdAt)]);
  check("11. fixture self-check: the mid-CD cut really leaves a valid EOCD pointing at a cut entry",
        (() => { const s = scanCD(cut); return !!s && s.eocdAt === rc.cdOff + 5 && s.cdOff === rc.cdOff && cut.readUInt32LE(rc.cdOff) === 0x02014b50; })(),
        { len: cut.length, eocdAt: rc.cdOff + 5, cdOff: rc.cdOff });
  const hostileOffset = [
    ["CD nameLen 65535 past EOF", (() => { const z = mkZipEx([{ name: "a.txt", data: Buffer.from("A"), method: 0 }]);
        const b = Buffer.from(z.buf); b.writeUInt16LE(65535, z.cdOff + 28); return b; })()],
    ["CD lho 0xFFFFFFFF (zip64 marker)", mkZip([{ name: "a.txt", data: Buffer.from("A"), method: 0, lho: 0xFFFFFFFF }])],
    ["CD lho 0x7FFFFFF0", mkZip([{ name: "a.txt", data: Buffer.from("A"), method: 0, lho: 0x7FFFFFF0 }])],
    ["cdOff in the last 3 bytes of the file", (() => { const b = Buffer.alloc(30);
        b.writeUInt32LE(0x06054b50, 8); b.writeUInt16LE(1, 8 + 10); b.writeUInt32LE(28, 8 + 16); return b; })()],
    ["real wave1 cut mid-central-directory", cut],
  ];
  const leaked = [];
  for (const [what, buf] of hostileOffset) {
    const r = await attempt(buf);
    if (!r.threw) leaked.push(what + " -> returned " + r.entries.length + " entries");
    else if (!(r.err instanceof Error) || !DIAG.test(r.err.message)) leaked.push(what + " -> " + r.err.constructor.name + ": " + JSON.stringify(r.err.message));
  }
  check("11. hostile structure offsets yield a reader diagnostic, never a raw DataView/typed-array error", leaked.length === 0,
        { leaked, note: "pack.js reads u32/u16 and builds Uint8Array views without checking that the offset is inside the buffer" });

  /* ------------------------------- 12. archive comments / EOCD signature steering */
  const two = mkZipEx([{ name: "one.gnaural", data: Buffer.from("ONE"), method: 0 },
                       { name: "two.gnaural", data: Buffer.from("TWO"), method: 0 }]);
  const honestCmt = Buffer.from("gnaural-web pack - GPL-2.0-or-later - no signature in here. ".repeat(2));
  await expectOk("12. honest trailing archive comment still parses",
                 mkZip([{ name: "one.gnaural", data: Buffer.from("ONE"), method: 0 }], { comment: honestCmt }), 1);
  await expectOk("12. honest comment appended to the real wave1.zip still parses (" + rc.files + " files)",
                 (() => { const b = Buffer.from(real), cmt = Buffer.from("licence: GPL-2.0-or-later");
                          b.writeUInt16LE(cmt.length, rc.eocdAt + 20); return Buffer.concat([b, cmt]); })(), rc.files);
  const fake = Buffer.alloc(60, 0x2e);
  Buffer.from([0x50, 0x4b, 0x05, 0x06]).copy(fake, 2);          /* EOCD signature inside the comment */
  /* the fake EOCD's own fields: entries-on-disk at sig+8, entries at sig+10,
   * cdOff at sig+16 — so comment offsets 10 / 12 / 18 */
  fake.writeUInt16LE(1, 10); fake.writeUInt16LE(1, 12); fake.writeUInt32LE(two.cdOff, 18);
  const steered = Buffer.concat([two.buf.slice(0, two.eocdAt), eocdRec(2, two.cdSize, two.cdOff, fake)]);
  const SIG = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  check("12. fixture self-check: the steered archive's comment really holds an EOCD signature",
        steered.lastIndexOf(SIG) > two.eocdAt && steered.lastIndexOf(SIG) <= steered.length - 22,
        { realEOCDat: two.eocdAt, lastSigAt: steered.lastIndexOf(SIG), len: steered.length });
  const honestCmt2 = Buffer.alloc(60, 0x2e);
  SIG.copy(honestCmt2, 2);
  honestCmt2.writeUInt16LE(2, 10); honestCmt2.writeUInt16LE(2, 12); honestCmt2.writeUInt32LE(two.cdOff, 18);
  await expectOk("12. control: the same comment with a truthful count=2 parses both entries",
                 Buffer.concat([two.buf.slice(0, two.eocdAt), eocdRec(2, two.cdSize, two.cdOff, honestCmt2)]), 2);
  /* DEFECT 4: the reader believes an EOCD-shaped blob found inside a comment */
  const got = await attempt(steered);
  check("12. an archive comment cannot steer the parse (comment bytes are not an EOCD)",
        !got.threw && got.entries.length === 2 && got.entries.map(e => e.name).join() === "one.gnaural,two.gnaural",
        got.threw ? { threw: got.err.message } : { got: got.entries.map(e => e.name), want: ["one.gnaural", "two.gnaural"], note: "findEOCD takes the last EOCD signature without checking record+comment reaches EOF" });
  await expectOk("12. comment-steered cdOff pointing at non-CD bytes is ignored (both entries parse)",
                 Buffer.concat([two.buf.slice(0, two.eocdAt),
                                eocdRec(2, two.cdSize, two.cdOff, (() => { const f = Buffer.alloc(60, 0x2e);
                                  SIG.copy(f, 2);
                                  f.writeUInt16LE(1, 10); f.writeUInt16LE(1, 12); f.writeUInt32LE(0, 18); return f; })())]), 2);

  /* ------------------------- 13. corrupt compressed payloads must be explained */
  const corrupt = [
    ["method 8 with csize=0", (() => { const z = mkZipEx([{ name: "c0.gnaural", method: 8, payload: Buffer.alloc(0), csize: 0, usize: MiB }]); return z.buf; })()],
    ["method 8 with 0xFF-filled payload", mkZip([{ name: "c1.gnaural", method: 8, payload: Buffer.alloc(64, 0xff), csize: 64, usize: 100 }])],
    ["method 8 with a plain-text payload", mkZip([{ name: "c2.gnaural", method: 8, payload: Buffer.from("this is not deflate data at all"), csize: 31, usize: 100 }])],
    ["deflate stream truncated (4 bytes cut)", (() => { const z = zlib.deflateRawSync(Buffer.alloc(MiB, 0), { level: 9 });
        return mkZip([{ name: "c3.gnaural", method: 8, payload: z.slice(0, z.length - 4), csize: z.length - 4, usize: MiB }]); })()],
    ["deflate stream truncated (half cut)", (() => { const z = zlib.deflateRawSync(Buffer.alloc(MiB, 0), { level: 9 });
        return mkZip([{ name: "c4.gnaural", method: 8, payload: z.slice(0, Math.floor(z.length / 2)), csize: Math.floor(z.length / 2), usize: MiB }]); })()],
    ["single 0x00 byte as a deflate stream", mkZip([{ name: "c5.gnaural", method: 8, payload: Buffer.alloc(1), csize: 1, usize: 100 }])],
  ];
  const unexplained = [];
  for (const [what, buf] of corrupt) {
    const r = await attempt(buf);
    if (!r.threw) unexplained.push(what + " -> returned " + r.entries.length + " entries");
    else if (!(r.err instanceof Error) || !DIAG.test(r.err.message)) unexplained.push(what + " -> " + r.err.constructor.name + ": " + JSON.stringify(r.err.message));
  }
  check("13. a corrupt/truncated compressed payload yields a reader diagnostic (not an empty-message TypeError)", unexplained.length === 0,
        { unexplained, note: "inflate() lets the DecompressionStream pipeline error escape; Node reports a TypeError with an EMPTY message, so the app's toast shows 'Could not read pack: ' with no reason" });
  await expectThrow("13. stored entry (method 0) with csize past EOF is still rejected cleanly",
                    mkZip([{ name: "s.bin", method: 0, payload: Buffer.from("abc"), csize: 100, usize: 100 }]),
                    "damaged zip (s.bin runs past the end)");

  /* ------------------------------------------------- 14. oracle + misc */
  check("14. oracle self-check: the diagnostics regex matches the reader's real messages",
        DIAG.test(NOTZIP) && DIAG.test(Z64) && DIAG.test(BADCD) && DIAG.test("pack is too large") &&
        DIAG.test("a.gnaural is too large for a preset pack") && DIAG.test("too many files in this pack") &&
        DIAG.test("unsupported compression method 12") && !DIAG.test("Offset is outside the bounds of the DataView") &&
        !DIAG.test("Invalid typed array length: 38") && !DIAG.test(""), null);
  const dup = await expectOk("14. duplicate entry names are both returned (no dedupe in the reader)",
                             mkZip([{ name: "d.gnaural", data: Buffer.from("1"), method: 0 },
                                    { name: "d.gnaural", data: Buffer.from("2"), method: 0 }]), 2);
  check("14. duplicate names keep their own payloads",
        !dup.threw && dup.entries[0].bytes[0] === 49 && dup.entries[1].bytes[0] === 50,
        dup.threw ? { threw: dup.err.message } : dup.entries.map(e => e.bytes[0]));
  await expectOk("14. utf-8 names decode, CR/LF survive verbatim",
                 mkZip([{ name: "wave/\u00e9\u4e2d\u6587 - test.gnaural", data: Buffer.from("u"), method: 0 },
                        { name: "a\nb\r.c.gnaural", data: Buffer.from("n"), method: 0 }]), 2,
                 ["wave/\u00e9\u4e2d\u6587 - test.gnaural", "a\nb\r.c.gnaural"]);

  console.log("edge: " + (pass + fail) + " checks over " + parses + " parseZip() calls of hostile input, baseline pack/wave1.zip " + real.length + " bytes");
  console.log(pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})().catch(err => { console.log("  FAIL harness crashed -> " + (err && err.stack || err)); console.log((pass) + " passed, " + (fail + 1) + " failed"); process.exit(1); });
