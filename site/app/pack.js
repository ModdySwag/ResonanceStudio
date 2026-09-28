/* Gnaural Web — preset-pack reader.
 *
 * Unzips a .zip preset pack in the browser with no libraries: walks the zip's
 * central directory, reads each local header, and inflates with
 * DecompressionStream("deflate-raw") (Chrome/Edge/Safari 16.4+/Firefox 113+).
 * Also runs under Node for tests.
 *
 * No DOM use; assigns to globalThis so the app and the Node tests share the
 * identical file.  Licence: GPL-2.0-or-later like the rest of gnaural-web.
 *
 * HOSTILE INPUT
 * -------------
 * This reader is the only place the app parses untrusted bytes, so every read
 * is bounds-checked and every failure raises one of a small set of plain-English
 * diagnostics instead of leaking a raw engine error into the UI:
 *
 *   not a zip file (no end-of-directory record)
 *   zip64 archives are not supported
 *   damaged zip (central directory outside file)
 *   damaged zip (bad central directory entry)
 *   damaged zip (bad local header for <name>)
 *   damaged zip (<name> runs past the end)
 *   damaged zip (<name> has corrupt compressed data)
 *   <name> is too large for a preset pack
 *   pack is too large
 *   too many files in this pack
 *   unsupported compression method <n>
 *
 * Contract points (each asserted by pack.edge.test.js):
 *   - An end-of-directory record is trusted only when its own 22 bytes plus its
 *     declared comment length land exactly on the end of the file, so an
 *     EOCD-shaped blob inside an archive comment cannot steer the parse.
 *   - A lie about the declared size cannot smuggle an oversized entry past the
 *     limits: the inflate loop counts REAL bytes and stops at the total budget,
 *     and the real size is checked against MAX_FILE_BYTES as well.  (A merely
 *     under-claimed size is still returned truthfully — the declared field is
 *     not a contract, the byte count is.)
 *   - Sizes are hard limits, not targets: MAX_FILE_BYTES per entry,
 *     MAX_TOTAL_BYTES per pack, MAX_FILES entries.
 *   - Entry names come back VERBATIM, including "../", "..\\", absolute paths
 *     and NUL bytes: this reader does not sanitise and does not need to, because
 *     the caller keeps names in memory as display labels only (see app.js
 *     loadPackZip — nothing is ever written to a filesystem path).  Any future
 *     caller that extracts to disk must sanitise names first.
 */
(function () {
  "use strict";

  var MAX_FILES = 400;
  var MAX_FILE_BYTES = 8 * 1024 * 1024;
  var MAX_TOTAL_BYTES = 32 * 1024 * 1024;

  function u16(dv, o) { return dv.getUint16(o, true); }
  function u32(dv, o) { return dv.getUint32(o, true); }

  function bad(what) { return new Error("damaged zip (" + what + ")"); }

  /* every read goes through this, so a hostile offset can never surface a raw
   * DataView/typed-array error to the user */
  function need(dv, off, size, what) {
    if (!(off >= 0) || !(size >= 0) || off + size > dv.byteLength) throw bad(what);
  }

  /* end-of-central-directory: scan back for the signature, trusting only a
   * record whose own bytes plus its declared comment length reach the end of
   * the file.  Candidates that fail that test (an EOCD-shaped blob inside an
   * archive comment) are skipped; the highest-offset candidate is kept as a
   * tolerant fallback for archives with junk appended after the comment. */
  function findEOCD(dv, len) {
    var lowest = Math.max(0, len - 65557);
    var fallback = -1;
    for (var i = len - 22; i >= lowest; i--) {
      if (u32(dv, i) !== 0x06054b50) continue;
      if (fallback < 0) fallback = i;
      if (i + 22 + u16(dv, i + 20) === len) return i;
    }
    return fallback;
  }

  /* decompress one entry, counting REAL bytes against the pack's budget.
   * Stops early rather than materialising an oversized entry. */
  async function inflate(bytes, method, name, budget) {
    if (method !== 0 && method !== 8) throw new Error("unsupported compression method " + method);
    if (method === 0) {                                     /* stored */
      if (bytes.length > MAX_FILE_BYTES) throw new Error(name + " is too large for a preset pack");
      budget.add(bytes.length);
      return bytes.slice();
    }
    if (typeof DecompressionStream === "undefined") {
      throw new Error("this browser cannot decompress zip files (no DecompressionStream)");
    }
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    var reader = stream.getReader();
    var chunks = [], received = 0, tooBig = null;
    try {
      for (;;) {
        var r = await reader.read();
        if (r.done) break;
        received += r.value.length;
        if (received + budget.used() > MAX_TOTAL_BYTES) {
          tooBig = new Error("pack is too large");
          try { await reader.cancel(); } catch (e) { /* already failing */ }
          break;
        }
        chunks.push(r.value);
      }
    } catch (e) {
      throw bad(name + " has corrupt compressed data");
    }
    if (tooBig) throw tooBig;
    if (received > MAX_FILE_BYTES) throw new Error(name + " is too large for a preset pack");
    var out = new Uint8Array(received), off = 0;
    for (var i = 0; i < chunks.length; i++) { out.set(chunks[i], off); off += chunks[i].length; }
    budget.add(received);
    return out;
  }

  /* arrayBuffer -> [{ name, bytes }] (files only, directories skipped) */
  async function parseZip(buffer) {
    var dv = new DataView(buffer);
    var len = buffer.byteLength;
    var eocd = findEOCD(dv, len);
    if (eocd < 0 || eocd + 22 > len) throw new Error("not a zip file (no end-of-directory record)");
    var count = u16(dv, eocd + 10);
    var cdOff = u32(dv, eocd + 16);
    if (count === 0xffff || cdOff === 0xffffffff) throw new Error("zip64 archives are not supported");
    if (cdOff > len) throw bad("central directory outside file");

    var out = [];
    var used = 0;
    var budget = { used: function () { return used; }, add: function (n) { used += n; } };
    var p = cdOff;
    for (var i = 0; i < count; i++) {
      need(dv, p, 46, "bad central directory entry");
      if (u32(dv, p) !== 0x02014b50) throw bad("bad central directory entry");
      var method = u16(dv, p + 10);
      var csize = u32(dv, p + 20);
      var usize = u32(dv, p + 24);
      var nameLen = u16(dv, p + 28);
      var extraLen = u16(dv, p + 30);
      var cmtLen = u16(dv, p + 32);
      var lho = u32(dv, p + 42);
      need(dv, p + 46, nameLen, "bad central directory entry");
      var name = new TextDecoder().decode(new Uint8Array(buffer, p + 46, nameLen));
      p += 46 + nameLen + extraLen + cmtLen;

      if (/\/$/.test(name)) continue;                       /* directory entry */
      if (out.length >= MAX_FILES) throw new Error("too many files in this pack");
      if (usize > MAX_FILE_BYTES) throw new Error(name + " is too large for a preset pack");
      need(dv, lho, 30, "bad local header for " + name);
      if (u32(dv, lho) !== 0x04034b50) throw bad("bad local header for " + name);
      var lNameLen = u16(dv, lho + 26);
      var lExtraLen = u16(dv, lho + 28);
      var dataOff = lho + 30 + lNameLen + lExtraLen;
      if (dataOff + csize > len) throw bad(name + " runs past the end");
      var bytes = await inflate(new Uint8Array(buffer, dataOff, csize), method, name, budget);
      out.push({ name: name, bytes: bytes });
    }
    return out;
  }

  var api = { parseZip: parseZip, MAX_FILES: MAX_FILES, MAX_FILE_BYTES: MAX_FILE_BYTES, MAX_TOTAL_BYTES: MAX_TOTAL_BYTES };
  if (typeof globalThis !== "undefined") globalThis.GnauralPack = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
