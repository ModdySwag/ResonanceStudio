/* Gnaural Web — .gnaural (XML schedule) reader.
 *
 * Reads the Gnaural preset format (gnauralfile_version 1.20101006) as produced by
 * Gnaural / Gnaural for Java.  Semantics per the upstream readers (gnauralXML.c /
 * org.gnaural.GnauralReadXMLFile), independently re-implemented:
 *   - the file stores the TRUE beat frequency in Hz (halving happens at engine load)
 *   - volumes are linear 0..1; durations are seconds
 *   - <loops> 0 means infinite
 *   - voices are re-created by grouping CONSECUTIVE entries with the same `parent`
 *     attribute; the <voice>/<entries> nesting is cosmetic (upstream loader is flat)
 *   - header counts (voicecount/entrycount/totaltime) are advisory only: real files
 *     disagree with their own contents, so durations are derived from entry sums
 *   - voice types: 0 binaural, 1 pink noise, 2 PCM file, 3 isopulse, 4 isopulse-alt,
 *     5 water drops, 6 rain
 *
 * This file is part of gnaural-web, licensed GPL-2.0-or-later (see NOTICE.txt).
 * Runs in the browser and in Node — no dependencies, no DOM.
 */
(function () {
  "use strict";

  /* ---------- minimal XML reader (declarations, comments, elements, attrs, text) ---------- */
  function parseXML(src) {
    var i = 0, n = src.length;
    var root = { tag: "#document", attrs: {}, children: [], text: "" };
    var stack = [root];
    function err(msg) { throw new Error("XML: " + msg + " (at " + i + ")"); }
    function findTagEnd(from) {
      var q = null;
      for (var j = from + 1; j < n; j++) {
        var c = src.charAt(j);
        if (q) { if (c === q) q = null; }
        else if (c === '"' || c === "'") q = c;
        else if (c === ">") return j;
      }
      return -1;
    }
    function parseAttrs(text) {
      var attrs = {}, re = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g, m;
      while ((m = re.exec(text)) !== null) attrs[m[1]] = unescapeXML(m[2] !== undefined ? m[2] : m[3]);
      return attrs;
    }
    while (i < n) {
      var lt = src.indexOf("<", i);
      if (lt === -1) { stack[stack.length - 1].text += src.slice(i); break; }
      if (lt > i) stack[stack.length - 1].text += src.slice(i, lt);
      if (src.substr(lt, 4) === "<!--") {
        var endc = src.indexOf("-->", lt + 4);
        if (endc === -1) err("unterminated comment");
        i = endc + 3; continue;
      }
      if (src.substr(lt, 2) === "<?") {
        var endp = src.indexOf("?>", lt + 2);
        if (endp === -1) err("unterminated processing instruction");
        i = endp + 2; continue;
      }
      if (src.substr(lt, 2) === "<!") {
        var endd = src.indexOf(">", lt);
        if (endd === -1) err("unterminated declaration");
        i = endd + 1; continue;
      }
      var gt = findTagEnd(lt);
      if (gt === -1) err("unterminated tag");
      var inner = src.slice(lt + 1, gt).trim();
      if (inner.charAt(0) === "/") {
        var closeTag = inner.slice(1).trim();
        var top = stack.pop();
        if (!top || top.tag !== closeTag) err("mismatched close </" + closeTag + ">");
        i = gt + 1; continue;
      }
      var selfClose = inner.charAt(inner.length - 1) === "/";
      if (selfClose) inner = inner.slice(0, -1).trim();
      var sp = inner.search(/\s/);
      var tag = sp === -1 ? inner : inner.slice(0, sp);
      var node = { tag: tag, attrs: parseAttrs(sp === -1 ? "" : inner.slice(sp + 1)), children: [], text: "" };
      stack[stack.length - 1].children.push(node);
      if (!selfClose) stack.push(node);
      i = gt + 1;
    }
    return root;
  }

  function child(node, tag) {
    for (var i = 0; i < node.children.length; i++) if (node.children[i].tag === tag) return node.children[i];
    return null;
  }
  function text(node, tag, dflt) {
    var c = child(node, tag);
    if (!c) return dflt;
    var t = unescapeXML(c.text).trim();
    return t === "" ? dflt : t;
  }
  /* XML entities -> characters. Gnaural writes plain text, but titles and
   * descriptions can legitimately contain &amp;/&lt;/&gt;/&quot;/&apos;. */
  function unescapeXML(s) {
    return String(s === undefined || s === null ? "" : s)
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&amp;/g, "&");
  }
  function fnum(v, dflt) {
    if (v === undefined || v === null || v === "") return dflt;
    var f = parseFloat(v);
    return isFinite(f) ? f : dflt;
  }
  function inum(v, dflt) {
    var f = fnum(v, NaN);
    return isFinite(f) ? Math.round(f) : dflt;
  }
  /* walk the whole tree in document order */
  function walk(node, fn) {
    for (var i = 0; i < node.children.length; i++) { fn(node.children[i]); walk(node.children[i], fn); }
  }

  var SUPPORTED_TYPES = { 0: true, 1: true, 3: true, 4: true, 7: true, 8: true };  // engine voices we can play
  var TYPE_NAMES = {
    0: "binaural beat", 1: "pink noise", 2: "audio file", 3: "isochronic pulses",
    4: "alt isochronic pulses", 5: "water drops", 6: "rain",
    7: "white noise", 8: "brown noise"   /* 7/8 = this project's extension types */
  };

  /* ------------------------------------------------------------------ *
   * parseGnaural(xmlText) -> parsed schedule (plain object)
   * ------------------------------------------------------------------ */
  function parseGnaural(xmlText) {
    var warnings = [];
    var root = parseXML(xmlText);
    var sched = child(root, "schedule");
    if (!sched) throw new Error("not a Gnaural schedule: no <schedule> element");

    var version = text(sched, "gnauralfile_version", null);
    if (version && version !== "1.20101006") {
      warnings.push("file format version " + version + " (expected 1.20101006) — reading anyway");
    }

    var loops = inum(text(sched, "loops", "1"), 1);
    var out = {
      formatVersion: version,
      gnauralVersion: text(sched, "gnaural_version", null),
      title: text(sched, "title", ""),
      description: text(sched, "schedule_description", ""),
      author: text(sched, "author", ""),
      loops: loops,
      overallVolL: fnum(text(sched, "overallvolume_left", "1"), 1),
      overallVolR: fnum(text(sched, "overallvolume_right", "1"), 1),
      stereoSwap: !!inum(text(sched, "stereoswap", "0"), 0),
      graphView: inum(text(sched, "graphview", "1"), 1),
      voices: [],
      warnings: warnings
    };

    /* voice metadata blocks, in document order */
    var meta = [];
    walk(sched, function (el) {
      if (el.tag !== "voice") return;
      meta.push({
        description: text(el, "description", ""),
        id: inum(text(el, "id", "-1"), -1),
        type: inum(text(el, "type", "0"), 0),
        state: inum(text(el, "voice_state", "0"), 0),
        hide: inum(text(el, "voice_hide", "0"), 0),
        mute: !!inum(text(el, "voice_mute", "0"), 0),
        mono: !!inum(text(el, "voice_mono", "0"), 0),
        declaredEntryCount: inum(text(el, "entrycount", "-1"), -1)
      });
    });
    if (meta.length === 0) warnings.push("no <voice> blocks — grouping entries by parent only");

    /* entries, in document order; group CONSECUTIVE runs sharing the same `parent` */
    var entries = [];
    walk(sched, function (el) {
      if (el.tag !== "entry") return;
      entries.push({
        parent: el.attrs.parent !== undefined ? el.attrs.parent : "0",
        duration: fnum(el.attrs.duration, 0),
        volL: fnum(el.attrs.volume_left, 1),
        volR: fnum(el.attrs.volume_right, fnum(el.attrs.volume_left, 1)),
        beat: fnum(el.attrs.beatfreq, 0),      /* true Hz, NOT halved */
        base: fnum(el.attrs.basefreq, 0),
        state: fnum(el.attrs.state, 0)
      });
    });
    if (entries.length === 0) throw new Error("schedule contains no <entry> elements");

    var groups = [];
    var cur = null;
    for (var i = 0; i < entries.length; i++) {
      if (!cur || entries[i].parent !== cur.parent) { cur = { parent: entries[i].parent, entries: [] }; groups.push(cur); }
      cur.entries.push(entries[i]);
    }

    for (var g = 0; g < groups.length; g++) {
      var m = meta[g] || {};
      var grp = groups[g];
      var v = {
        index: g,
        parent: grp.parent,
        description: m.description || "",
        id: (m.id === undefined ? g : m.id),
        type: (m.type === undefined ? 0 : m.type),
        mute: !!m.mute, mono: !!m.mono, hide: !!m.hide, state: m.state || 0,
        playable: !!SUPPORTED_TYPES[m.type === undefined ? 0 : m.type],
        typeName: TYPE_NAMES[m.type === undefined ? 0 : m.type] || ("type " + m.type),
        entries: grp.entries
      };
      var sum = 0;
      for (var e = 0; e < v.entries.length; e++) sum += v.entries[e].duration;
      v.duration = sum;
      out.voices.push(v);
    }

    /* advisory-only header checks */
    var declaredVoices = inum(text(sched, "voicecount", "-1"), -1);
    if (declaredVoices >= 0 && declaredVoices !== out.voices.length) {
      warnings.push("voicecount says " + declaredVoices + ", grouped " + out.voices.length +
                    " (header counts in Gnaural files are unreliable)");
    }
    var durations = out.voices.map(function (v) { return v.duration; });
    out.duration = durations.length ? Math.max.apply(null, durations) : 0;

    var unsupported = out.voices.filter(function (v) { return !v.playable; });
    if (unsupported.length) {
      warnings.push(unsupported.length + " voice(s) use types not yet playable in the browser build: " +
        unsupported.map(function (v) { return "#" + v.index + " " + v.typeName; }).join(", "));
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * toEngineSchedule(parsed) -> schedule for GnauralEngine.setSchedule()
   * Unplayable voices are dropped (with the warning already recorded above).
   * ------------------------------------------------------------------ */
  function toEngineSchedule(parsed) {
    var voices = [];
    for (var i = 0; i < parsed.voices.length; i++) {
      var v = parsed.voices[i];
      if (!v.playable) continue;
      voices.push({
        type: v.type,
        mute: !!v.mute,
        mono: !!v.mono,
        entries: v.entries.map(function (e) {
          return { duration: e.duration, volL: e.volL, volR: e.volR, basefreq: e.base, beat: e.beat };
        })
      });
    }
    return {
      voices: voices,
      loops: parsed.loops === 0 ? Infinity : parsed.loops,
      volumeL: parsed.overallVolL,
      volumeR: parsed.overallVolR,
      stereoSwap: parsed.stereoSwap
    };
  }

  /* ------------------------------------------------------------------ *
   * writeGnaural(schedule) -> XML text.
   * Mirrors what upstream gnauralXML.c emits, so our exports open in
   * Gnaural itself: <schedule> with header fields, one <voice> metadata
   * block per voice (id order) followed by that voice's <entry> children.
   * schedule:  { title, description, author, loops, overallVolL/R,
   *              stereoSwap, voices: [{type, mute, mono, description,
   *              entries: [{duration, volL, volR, basefreq, beat}]}] }
   * ------------------------------------------------------------------ */
  function escapeXML(s) {
    return String(s === undefined || s === null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function f(v, dflt) {
    var n = parseFloat(v);
    if (!isFinite(n)) { var d = parseFloat(dflt); n = isFinite(d) ? d : 0; }
    if (typeof n !== "number" || !isFinite(n)) n = 0;
    /* 6 significant decimals, no exponent, no trailing zeros */
    var out = n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
    return out === "" || out === "-0" ? "0" : out;
  }
  function entryXML(e, indent) {
    var pad = indent || "      ";
    return pad + '<entry parent="' + f(e.parent, 0) + '" duration="' + f(e.duration, 0) +
      '" volume_left="' + f(e.volL, 1) + '" volume_right="' + f(e.volR, f(e.volL, 1)) +
      '" beatfreq="' + f(e.beat, 0) + '" basefreq="' + f(e.base, 0) +
      '" state="1"/>';
  }
  var GNAURAL_VERSION = "1.0.20110606";   /* the upstream release this port follows */
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  function asctime(d) {
    function p2(x) { return (x < 10 ? " " : "") + x; }
    return DAYS[d.getDay()] + " " + MONTHS[d.getMonth()] + " " + p2(d.getDate()) + " " +
      p2(d.getHours()) + ":" + p2(d.getMinutes()) + ":" + p2(d.getSeconds()) + " " + d.getFullYear();
  }
  /* Writes the shape upstream gnauralXML.c emits: <schedule> is the ROOT element
   * (no wrapper — real Gnaural files have none, and our own parser expects it
   * directly), fields in upstream order, each voice's entries inside <entries>. */
  function writeGnaural(sched) {
    sched = sched || {};
    var voices = sched.voices || [];
    if (!voices.length) throw new Error("nothing to write: schedule has no voices");
    var total = 0, totalEntries = 0;
    for (var i = 0; i < voices.length; i++) {
      var es = (voices[i] && voices[i].entries) || [];
      if (!es.length) throw new Error("voice " + i + " has no entries");
      var vs = 0;
      for (var j = 0; j < es.length; j++) vs += fnum(es[j].duration, 0);
      if (vs > total) total = vs;
      totalEntries += es.length;
    }
    var lines = [];
    lines.push('<?xml version="1.0"?>');
    lines.push("<!-- Written by Gnaural Web, a web re-implementation of Gnaural -->");
    lines.push("<schedule>");
    lines.push("<gnauralfile_version>1.20101006</gnauralfile_version>");
    lines.push("<gnaural_version>" + escapeXML(sched.gnauralVersion || GNAURAL_VERSION) + "</gnaural_version>");
    lines.push("<date>" + escapeXML(sched.date || asctime(new Date())) + "\n</date>");
    lines.push("<title>" + escapeXML(sched.title || "") + "</title>");
    lines.push("<schedule_description>" + escapeXML(sched.description || "") + "</schedule_description>");
    lines.push("<author>" + escapeXML(sched.author || "") + "</author>");
    lines.push("<totaltime>" + f(total, 0) + "</totaltime>");
    lines.push("<voicecount>" + voices.length + "</voicecount>");
    lines.push("<totalentrycount>" + totalEntries + "</totalentrycount>");
    lines.push("<loops>" + (sched.loops === Infinity ? "0" : f(sched.loops === undefined ? 1 : sched.loops, 1)) + "</loops>");
    lines.push("<overallvolume_left>" + f(sched.overallVolL, 1) + "</overallvolume_left>");
    lines.push("<overallvolume_right>" + f(sched.overallVolR, 1) + "</overallvolume_right>");
    lines.push("<stereoswap>" + (sched.stereoSwap ? 1 : 0) + "</stereoswap>");
    lines.push("<graphview>1</graphview>");
    for (var v = 0; v < voices.length; v++) {
      var V = voices[v] || {};
      var entries = V.entries;
      lines.push("<voice>");
      lines.push("<description>" + escapeXML(V.description || "") + "</description>");
      lines.push("<id>" + v + "</id>");
      lines.push("<type>" + (V.type | 0) + "</type>");
      lines.push("<voice_state>1</voice_state>");
      lines.push("<voice_hide>0</voice_hide>");
      lines.push("<voice_mute>" + (V.mute ? 1 : 0) + "</voice_mute>");
      lines.push("<voice_mono>" + (V.mono ? 1 : 0) + "</voice_mono>");
      lines.push("<entrycount>" + entries.length + "</entrycount>");
      lines.push("<entries>");
      for (var e = 0; e < entries.length; e++) {
        var E = entries[e];
        lines.push(entryXML({ parent: v, duration: E.duration, volL: E.volL, volR: E.volR, beat: E.beat, base: E.basefreq, state: 1 }));
      }
      lines.push("</entries>");
      lines.push("</voice>");
    }
    lines.push("</schedule>");
    return lines.join("\n") + "\n";
  }

  /* Round-trip convenience: engine schedule (what app.js plays, entries with
   * beatHalf/basefreq/volL/volR) -> the parseGnaural() shape -> writer input. */
  function engineScheduleToGnaural(engineVoices, meta) {
    meta = meta || {};
    return {
      title: meta.title || "", description: meta.description || "", author: meta.author || "",
      loops: meta.loops, overallVolL: meta.overallVolL, overallVolR: meta.overallVolR,
      stereoSwap: meta.stereoSwap,
      voices: (engineVoices || []).map(function (v) {
        return {
          type: v.type | 0, mute: !!v.mute, mono: !!v.mono, description: v.description || "",
          entries: (v.entries || []).map(function (e) {
            return {
              duration: e.duration,
              volL: (e.volL_spread !== undefined ? e.volL_start : e.volL),
              volR: (e.volR_spread !== undefined ? e.volR_start : e.volR),
              beat: (e.beatfreq_start_HALF !== undefined ? e.beatfreq_start_HALF * 2 : e.beat),
              basefreq: (e.basefreq_start !== undefined ? e.basefreq_start : e.basefreq)
            };
          })
        };
      })
    };
  }

  var api = {
    parseGnaural: parseGnaural,
    toEngineSchedule: toEngineSchedule,
    writeGnaural: writeGnaural,
    engineScheduleToGnaural: engineScheduleToGnaural,
    TYPE_NAMES: TYPE_NAMES,
    SUPPORTED_TYPES: SUPPORTED_TYPES
  };
  if (typeof globalThis !== "undefined") globalThis.GnauralGNM = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
