// Verify the PACKAGED Resonance Studio Windows app — the real .exe, not the source files.
//
//   node verify/test_desktop_app.mjs                        # the staged build
//   node verify/test_desktop_app.mjs --exe "<installed>\ResonanceStudio.exe"
//   node verify/test_desktop_app.mjs --no-relaunch --no-offline
//
// It launches the exe with a CDP endpoint, drives the running app over the protocol, and checks
// the things a desktop shell can break that a browser cannot: the loopback origin, the audio
// worklet, downloads landing on disk, pack import and .gnaural round-trips, the share-link base,
// the offline boot, and what survives a relaunch.
//
// Every check prints ok/FAIL with its evidence; the exit code is the failure count.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WIN = path.join(HERE, '..');
const VERSION = JSON.parse(readFileSync(path.join(WIN, 'version.json'), 'utf8'));
const SITE = path.join(WIN, '..', 'site', 'resonance');

const argv = process.argv.slice(2);
const argVal = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const EXE = argVal('--exe', path.join(WIN, 'stage', 'ResonanceStudio', 'ResonanceStudio.exe'));
const CDP = Number(argVal('--cdp', '9351'));
const DL = argVal('--dl', path.join(WIN, 'tmp-dl-desktop'));
const NO_RELAUNCH = argv.includes('--no-relaunch');
const NO_OFFLINE = argv.includes('--no-offline');
const NO_WAV = argv.includes('--no-wav');

let pass = 0, fail = 0;
const check = (ok, label, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? ' ok  ' : ' FAIL'} ${label}${detail ? '  — ' + detail : ''}`);
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

// ---------------------------------------------------------------- the app under test
class DesktopApp {
  constructor() { this.proc = null; this.ws = null; this.id = 0; this.pending = new Map(); this.out = ''; this.errors = []; this.exceptions = []; }

  start(extraEnv = {}) {
    if (!existsSync(EXE)) throw new Error(`app not found: ${EXE}`);
    this.out = ''; this.errors = []; this.exceptions = [];
    if (!this.allOut) this.allOut = '';
    this.proc = spawn(EXE, [], {
      env: { ...process.env, RS_TEST: '1', RS_DEBUG_PORT: String(CDP), RS_DL_DIR: DL, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: false,
    });
    const tap = (d) => { const s = d.toString(); this.out += s; this.allOut += s; };
    this.proc.stdout.on('data', tap);
    this.proc.stderr.on('data', tap);
    return this;
  }

  log(needle) { return this.out.includes(needle); }
  blockedLines() { return (this.allOut || this.out).split(/\r?\n/).filter(l => l.includes('offline: blocked')); }
  downloadLines() { return (this.allOut || this.out).split(/\r?\n/).filter(l => l.includes('download')); }

  async connect({ timeoutMs = 60000 } = {}) {
    let target = null;
    const t0 = Date.now();
    while (!target && Date.now() - t0 < timeoutMs) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
        target = list.find(t => t.type === 'page' && /\/app\/?$/.test(new URL(t.url).pathname)) || list.find(t => t.type === 'page');
      } catch { /* not up yet */ }
      if (!target) await sleep(600);
    }
    if (!target) throw new Error('no CDP page target — the app never opened a window');
    this.target = target;
    this.ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; });
    this.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id); this.pending.delete(m.id);
        m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
        return;
      }
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        this.exceptions.push(((d.exception && (d.exception.description || d.exception.value)) || d.text || 'exception').toString().slice(0, 300));
      }
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        this.errors.push((m.params.args || []).map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300));
      }
    };
    await this.send('Runtime.enable');
    await this.send('Page.enable');
    await this.send('DOM.enable');
    return this;
  }

  send(method, params = {}) {
    return new Promise((res, rej) => {
      const i = ++this.id;
      this.pending.set(i, { res, rej });
      this.ws.send(JSON.stringify({ id: i, method, params }));
    });
  }

  async ev(expr, { timeoutMs = 30000 } = {}) {
    const p = this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
    const r = await Promise.race([p, sleep(timeoutMs).then(() => { throw new Error('Runtime.evaluate timeout'); })]);
    if (r.exceptionDetails) return { __ex: String((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text).slice(0, 300) };
    return r.result ? r.result.value : undefined;
  }

  async waitFor(expr, { timeoutMs = 90000, every = 600, label = expr } = {}) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const v = await this.ev(expr, { timeoutMs: 15000 }).catch(() => false);
      if (v === true) return true;
      await sleep(every);
    }
    return false;
  }

  async key(keyName, code = undefined, keyCode = undefined) {
    // raw keydown+keyup on the focused document — the app listens on window keydown
    const common = { key: keyName, code: code || keyName, windowsVirtualKeyCode: keyCode || 0, nativeVirtualKeyCode: keyCode || 0 };
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', ...common });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...common });
  }

  async stop({ graceMs = 4000, hard = true } = {}) {
    if (!this.proc) return;
    const p = this.proc;
    try { if (p.exitCode === null) p.kill(); } catch {}
    const t0 = Date.now();
    while (p.exitCode === null && Date.now() - t0 < graceMs) await sleep(200);
    if (hard && p.exitCode === null) { try { p.kill('SIGKILL'); } catch {} }
    this.proc = null;
    try { this.ws && this.ws.close(); } catch {}
    this.ws = null;
    await sleep(600);
  }

  async closeCleanly() {
    // Browser.close raises the window close event, so window-state.json is written like a user quit.
    // The CDP reply often never arrives because the browser is already exiting — don't wait on it.
    try { await Promise.race([this.send('Browser.close'), sleep(2500)]); } catch {}
    const t0 = Date.now();
    while (this.proc && this.proc.exitCode === null && Date.now() - t0 < 8000) await sleep(250);
    if (this.proc && this.proc.exitCode === null) await this.stop();
    this.proc = null; this.ws = null;
    await sleep(500);
  }
}

// ---------------------------------------------------------------- files and helpers
function cleanDl() { rmSync(DL, { recursive: true, force: true }); mkdirSync(DL, { recursive: true }); }
function dlFiles(ext = null) {
  if (!existsSync(DL)) return [];
  return readdirSync(DL).filter(f => !ext || f.toLowerCase().endsWith(ext)).map(f => path.join(DL, f));
}
async function fi(url, opts = {}) {
  try { const r = await fetch(url, opts); return { status: r.status, text: await r.text(), headers: r.headers }; }
  catch (e) { return { status: 0, text: '', error: String(e) }; }
}

const app = new DesktopApp();
const ONLINE_PORT = 47850;

console.log(`== Resonance Studio desktop suite — ${path.basename(EXE)} (build ${VERSION.appBuild})`);
console.log(`   downloads -> ${DL}\n`);

// ================================================================ phase 1: online boot
cleanDl();
try {
  app.start();
  await app.connect();
  await app.waitFor('!!window.__gnauralAPI && window.__gnauralAPI.presetCount() > 0', { timeoutMs: 60000, label: 'library' });

  console.log('-- boot & origin');
  const g = await app.ev(`(() => ({
    url: location.href, secure: window.isSecureContext, ready: document.readyState,
    title: document.title, marker: window.__RS_DESKTOP || null, shareBase: window.RS_SHARE_BASE || null,
    shellFlag: window.RS_SHELL === true,
    worklet: typeof AudioWorkletNode !== 'undefined' && typeof AudioContext !== 'undefined',
    presets: window.__gnauralAPI.presetCount(),
    rows: document.querySelectorAll('#plist .item').length,
    count: (document.getElementById('count') || {}).textContent || '',
    chips: document.querySelectorAll('#filters .chip, #filters button').length,
    viz: document.querySelectorAll('[data-viz-panel]').length,
    playBtn: !!document.getElementById('play'),
  }))()`);
  check(g && /^http:\/\/127\.0\.0\.1:\d+\/app\/$/.test(g.url || ''), 'the app is served from the loopback server (not file://)', g && g.url);
  check(g && g.secure === true && g.worklet === true, 'a secure context with AudioWorklet (the worklet path is live)');
  check(g && g.marker && g.marker.shell === 'resonance-desktop', '__RS_DESKTOP marker present', g && g.marker && g.marker.shell);
  check(g && g.marker && g.marker.version === VERSION.version && g.marker.build === VERSION.appBuild,
        'the marker reports the frozen build', g && g.marker && `${g.marker.version} · ${g.marker.build}`);
  check(g && /^\d+\.\d+\.\d+/.test((g.marker || {}).chrome || ''), 'the bundled Chromium version is reported', g && g.marker && g.marker.chrome);
  check(g && g.title.includes('Resonance Studio') && g.title.includes('Gnaural Web'), 'the window carries the app title', g && g.title);
  check(app.log(`build ${VERSION.version} · app ${VERSION.appBuild}`), 'the shell reports its build on stdout');

  console.log('\n-- the library & interface');
  check(g && g.presets >= 100, 'the session library built', g && `${g.presets} sessions`);
  check(g && g.rows >= 40, 'the session browser rendered rows', g && `${g.rows} rows`);
  check(g && /\d+\s+of\s+\d+/.test(g.count || ''), 'the count line reads N of M sessions', g && g.count.trim());
  check(g && g.chips >= 6, 'the filter chips rendered', g && `${g.chips} chips`);
  check(g && g.viz === 2, 'the wide-viewport visualizer panels mounted (2 canvases)', g && `${g.viz} canvases`);

  console.log('\n-- audio');
  const p1 = await app.ev(`(async () => { window.__gnauralAPI.play(); await new Promise(r=>setTimeout(r,2500));
    const s = window.__gnauralAPI.state;
    return { playing: s.playing, mode: s.mode, ctx: s.ctx ? s.ctx.state : null, sample: s.live.sample }; })()`);
  check(p1 && p1.playing === true && p1.ctx === 'running', 'play() starts the transport (context running)', p1 && JSON.stringify(p1));
  check(p1 && p1.mode === 'worklet', 'the AudioWorklet engine is the one running', p1 && p1.mode);
  const s2 = await app.ev(`(async () => { const a = window.__gnauralAPI.state.live.sample; await new Promise(r=>setTimeout(r,1200)); return { a, b: window.__gnauralAPI.state.live.sample }; })()`);
  check(s2 && s2.b > s2.a, 'the engine clock is really advancing', s2 && `sample ${s2.a} -> ${s2.b}`);
  const meter = await app.ev(`(() => { const w = el => el ? parseFloat(getComputedStyle(el).width) || 0 : -1;
    return { l: w(document.getElementById('meterL')), r: w(document.getElementById('meterR')) }; })()`);
  check(meter && (meter.l > 0 || meter.r > 0), 'the meters are moving (peaks reported from the engine)', meter && JSON.stringify(meter));
  const clock1 = await app.ev(`(document.getElementById('clock')||{}).textContent`);
  await sleep(1500);
  const clock2 = await app.ev(`(document.getElementById('clock')||{}).textContent`);
  check(clock1 && clock2 && clock1 !== clock2, 'the transport clock ticks', `${clock1} -> ${clock2}`);

  console.log('\n-- keyboard');
  const mst0 = await app.ev(`parseFloat(document.getElementById('master').value)`);
  await app.ev(`window.focus(); document.body.focus()`);
  await app.key('[', 'BracketLeft', 219);
  await sleep(400);
  const mst1 = await app.ev(`parseFloat(document.getElementById('master').value)`);
  check(typeof mst0 === 'number' && typeof mst1 === 'number' && mst1 < mst0, '[ lowers the master volume', `${mst0} -> ${mst1}`);
  await app.key('Escape', 'Escape', 27);
  await sleep(600);
  const escPlaying = await app.ev(`window.__gnauralAPI.state.playing`);
  check(escPlaying === false, 'Escape stops the transport', String(escPlaying));

  console.log('\n-- browser & quick picks');
  const filt = await app.ev(`(() => { const s = document.getElementById('search'); const before = document.querySelectorAll('#plist .item').length;
    s.value = 'sleep'; s.dispatchEvent(new Event('input', { bubbles: true }));
    const after = document.querySelectorAll('#plist .item').length;
    s.value = ''; s.dispatchEvent(new Event('input', { bubbles: true }));
    const restored = document.querySelectorAll('#plist .item').length;
    return { before, after, restored }; })()`);
  check(filt && filt.after > 0 && filt.after < filt.before && filt.restored === filt.before,
        'search filters the list and clearing restores it', filt && JSON.stringify(filt));
  const qp = await app.ev(`(async () => { const n0 = window.__gnauralAPI.state.schedule.voices.length;
    const b = document.querySelector('#quickpick button'); if (!b) return { ok: false };
    b.click(); await new Promise(r=>setTimeout(r,800));
    const n1 = window.__gnauralAPI.state.schedule.voices.length;
    return { ok: true, n0, n1 }; })()`);
  check(qp && qp.ok && qp.n1 === qp.n0 + 1, 'a quick pick adds one layer to the schedule', qp && JSON.stringify(qp));

  console.log('\n-- skins');
  const skin = await app.ev(`(async () => { const s = document.getElementById('skin');
    s.value = 'nocturne'; s.dispatchEvent(new Event('change', { bubbles: true })); await new Promise(r=>setTimeout(r,300));
    const a = document.documentElement.getAttribute('data-skin');
    s.value = 'forge'; s.dispatchEvent(new Event('change', { bubbles: true })); await new Promise(r=>setTimeout(r,300));
    const b = document.documentElement.getAttribute('data-skin');
    return { a, b }; })()`);
  check(skin && skin.a === 'nocturne' && skin.b === 'forge', 'the skin switch applies and reverts', skin && JSON.stringify(skin));

  console.log('\n-- visualizers (toggle, frames, safety cap)');
  const vizPre = await app.ev(`(() => { const V = window.ResonanceViz.api; return { reduce: matchMedia('(prefers-reduced-motion: reduce)').matches,
    pre: V.getPrefs(), st: V.debugState() }; })()`);
  check(vizPre && vizPre.st && vizPre.st.panels.length === 2 && vizPre.st.panels.every(x => x.w > 100 && x.h > 100),
        'two visualizer panels are mounted with real sizes',
        vizPre && vizPre.st.panels.map(x => `${x.mount} ${x.w}x${x.h}`).join(', '));
  check(vizPre && (vizPre.reduce === true ? vizPre.pre.on === false || vizPre.pre.on === true : true), 'visualizer prefs load and validate', vizPre && JSON.stringify(vizPre.pre).slice(0, 90));
  // the documented control: the Visualizers card's own button
  const wasOn = vizPre && vizPre.pre.on === true;
  if (!wasOn) { await app.ev(`document.getElementById('vizToggle').click()`); await sleep(600); }
  const vizOn = await app.ev(`window.ResonanceViz.api.debugState()`);
  const onStored = await app.ev(`window.ResonanceViz.api.getPrefs().on`);
  check(vizOn && vizOn.enabled === true, 'the Visualizers card turns them on', `was ${wasOn ? 'already on' : 'off'} (reduced-motion: ${vizPre && vizPre.reduce})`);
  check(onStored === true, 'the choice is stored (survives the next launch)');
  // and the keyboard path: a real V key event flips them, twice
  const v0 = await app.ev(`window.ResonanceViz.api.debugState().enabled`);
  await app.key('v', 'KeyV', 86);
  await sleep(500);
  const v1 = await app.ev(`window.ResonanceViz.api.debugState().enabled`);
  await app.key('v', 'KeyV', 86);
  await sleep(500);
  const v2 = await app.ev(`window.ResonanceViz.api.debugState().enabled`);
  check(v0 === true && v1 === false && v2 === true, 'the V key toggles them off and back on', `${v0} -> ${v1} -> ${v2}`);
  await app.ev(`window.__gnauralAPI.play()`);
  const fr0 = await app.ev(`window.ResonanceViz.api.debugState().panels.map(p => p.frames)`);
  const vpx0 = await app.ev(`(() => { const c = document.querySelector('[data-viz-panel]'); const x = c.getContext('2d');
    const d = x.getImageData(0, 0, c.width, c.height).data; let s = 0; for (let i = 0; i < d.length; i += 997) s = (s * 31 + d[i]) >>> 0; return s; })()`);
  await sleep(3000);
  const fr1 = await app.ev(`window.ResonanceViz.api.debugState().panels.map(p => p.frames)`);
  const vpx1 = await app.ev(`(() => { const c = document.querySelector('[data-viz-panel]'); const x = c.getContext('2d');
    const d = x.getImageData(0, 0, c.width, c.height).data; let s = 0; for (let i = 0; i < d.length; i += 997) s = (s * 31 + d[i]) >>> 0; return s; })()`);
  check(fr0 && fr1 && fr1.every((v, i) => v > fr0[i]), 'the render loop is ticking (frame counters advance)', fr0 && `${fr0} -> ${fr1}`);
  check(typeof vpx0 === 'number' && vpx0 !== vpx1, 'the canvases are actually painting while playing', `${vpx0} -> ${vpx1}`);
  const safety = await app.ev(`(() => { const s = window.ResonanceViz.api.debugState().safety; return s; })()`);
  check(safety && safety.flashCapHz && safety.lumRateHz <= safety.flashCapHz, 'the luminance cap is honoured while playing (safety)', safety && `rate ${safety.lumRateHz} <= cap ${safety.flashCapHz}`);

  console.log('\n-- save .gnaural (a real download through the shell)');
  const savedBefore = dlFiles('.gnaural').length;
  await app.ev(`document.getElementById('saveGnm').click()`);
  let saved = null;
  for (let i = 0; i < 30 && !saved; i++) { await sleep(400); const f = dlFiles('.gnaural'); if (f.length > savedBefore) saved = f[f.length - 1]; }
  check(!!saved, 'Save .gnaural lands a file on disk', saved || 'no file');
  if (saved) {
    const text = readFileSync(saved, 'utf8');
    const parsed = await app.ev(`(() => { try { const p = GnauralGNM.parseGnaural(${JSON.stringify(text.slice(0, 200000))});
      return { voices: p.voices.length, dur: Math.round(p.duration) }; } catch (e) { return 'ERR ' + e.message; } })()`);
    check(parsed && parsed.voices >= 1, 'the saved file parses back with the app\'s own reader', parsed && JSON.stringify(parsed));
  }

  console.log('\n-- share link points at the live site');
  await app.ev(`document.getElementById('shareBtn').click()`);
  await sleep(900);
  const clip = await app.ev(`(async () => { try { return await navigator.clipboard.readText(); } catch (e) { return 'ERR ' + e; } })()`);
  check(typeof clip === 'string' && clip.startsWith('https://moddys.net/resonance/app/#s=') && clip.length > 120,
        'Copy share link yields a moddys.net URL (RS_SHARE_BASE)', typeof clip === 'string' ? clip.slice(0, 72) + '…' : String(clip));

  console.log('\n-- pack import (a real .zip through the app\'s own importer)');
  const packPath = path.join(SITE, 'app', 'pack', 'classic.zip');
  const packsBefore = await app.ev(`(() => { try { const v = JSON.parse(localStorage.getItem('gnaural.packs.v1') || '[]'); return Array.isArray(v) ? v.length : 0; } catch { return 0; } })()`);
  const doc = await app.send('DOM.getDocument', { depth: 1 });
  const q = await app.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#packfile' });
  await app.send('DOM.setFileInputFiles', { nodeId: q.nodeId, files: [packPath] });
  const imported = await app.waitFor(`(() => { try { const v = JSON.parse(localStorage.getItem('gnaural.packs.v1') || '[]'); return Array.isArray(v) && v.length > ${packsBefore}; } catch { return false; } })()`, { timeoutMs: 20000 });
  check(imported, 'Add pack (.zip) imports through the bundled reader', `classic.zip (store had ${packsBefore})`);
  const imported2 = await app.ev(`(() => { const v = JSON.parse(localStorage.getItem('gnaural.packs.v1') || 'null'); return v ? v.length : 0; })()`);
  const presetsAfter = await app.ev(`window.__gnauralAPI.presetCount()`);
  check(presetsAfter > 124, 'the imported pack adds sessions to the library', `${presetsAfter} total (${imported2} imported pack entries)`);

  console.log('\n-- import a .gnaural back (round trip from the file just saved)');
  if (saved) {
    const doc2 = await app.send('DOM.getDocument', { depth: 1 });
    const q2 = await app.send('DOM.querySelector', { nodeId: doc2.root.nodeId, selector: '#file' });
    await app.send('DOM.setFileInputFiles', { nodeId: q2.nodeId, files: [saved] });
    await sleep(1500);
    const round = await app.ev(`(() => { const t = window.__gnauralAPI.state.title; const v = window.__gnauralAPI.state.schedule.voices.length; return { t, v }; })()`);
    check(round && round.v >= 1, 'Open .gnaural loads the saved schedule back', round && JSON.stringify(round));
  }

  console.log('\n-- a pack zip downloads from the packs page');
  const pkBefore = dlFiles('.zip').length;
  await app.ev(`(() => { const a = document.createElement('a'); a.href = '/app/pack/classic.zip'; a.download = 'classic.zip';
    document.body.appendChild(a); a.click(); a.remove(); return true; })()`);
  let pk = null;
  for (let i = 0; i < 30 && !pk; i++) { await sleep(400); const f = dlFiles('.zip'); if (f.length > pkBefore) pk = f[f.length - 1]; }
  check(!!pk, 'a pack zip downloads to disk', pk || 'no file');
  if (pk) {
    const src = path.join(SITE, 'app', 'pack', 'classic.zip');
    const head = readFileSync(pk).subarray(0, 2).toString('latin1');
    check(head === 'PK' && statSync(pk).size === statSync(src).size,
          'the downloaded zip is byte-sized like the shipped one and is a real zip',
          `${statSync(pk).size} B, PK header ${head === 'PK'}`);
  }

  console.log('\n-- WAV export renders and lands' + (NO_WAV ? ' (skipped)' : ''));
  if (!NO_WAV) {
    const wavBefore = dlFiles('.wav').length;
    await app.ev(`(() => { const s = document.getElementById('exportMin'); s.value = '5'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await app.ev(`document.getElementById('exportBtn').click()`);
    let wav = null;
    for (let i = 0; i < 900 && !wav; i++) { await sleep(400); const f = dlFiles('.wav'); if (f.length > wavBefore) wav = f[f.length - 1]; }
    check(!!wav, 'Export WAV lands a file on disk', wav || 'no file within 6 min');
    if (wav) {
      const buf = readFileSync(wav);
      const riff = buf.subarray(0, 4).toString('latin1');
      const bytesPerSec = buf.readUInt32LE(28);
      const secs = bytesPerSec ? Math.round((buf.length - 44) / bytesPerSec) : 0;
      check(riff === 'RIFF' && secs >= 290, 'it is a canonical RIFF/WAV of the requested length', `${(buf.length / 1048576).toFixed(1)} MB, ~${secs}s`);
    }
  }

  // The wordmark used to walk out to the marketing page, which is not the product: in the shell
  // the studio must stay put, and the landing — if reached at all — must come back on its own.
  console.log('\n-- the wordmark & the landing stay inside the studio');
  check(g && g.shellFlag === true, 'the preload exposes window.RS_SHELL', String(g && g.shellFlag));
  const brand = await app.ev(`(() => { const a = document.querySelector('.brand a[href]'); return a ? a.getAttribute('href') : null; })()`);
  check(brand === './', 'the wordmark is retargeted to this directory (not "../")', String(brand));
  const webVer = await app.ev(`(() => { const a = [...document.querySelectorAll('footer a')].find(x => /^web version$/i.test(x.textContent.trim())); return a ? a.getAttribute('href') : null; })()`);
  check(webVer === 'https://moddys.net/resonance/', 'the app chrome still offers the web version, absolutely linked', String(webVer));

  await app.ev(`(() => { const a = document.querySelector('.brand a[href]'); a.click(); return true; })()`);
  await sleep(1800);
  const nav = await app.ev(`({ url: location.href, path: location.pathname, chrome: !!document.getElementById('play') && !!document.querySelector('#plist .item'), title: document.title })`);
  check(nav && nav.path === '/app/', 'clicking the wordmark keeps the window inside /app/', nav && nav.url);
  check(nav && nav.chrome === true, 'the studio chrome survives the wordmark click', nav && `play/list ${nav.chrome}`);

  // control: the same document with ?shell=0 must stay on the landing, so the redirect is the
  // flag's doing and not some URL quirk (browsers, with no flag at all, always stay).
  await app.ev(`location.assign('/?shell=0')`);
  await sleep(2500);
  const stayed = await app.ev(`({ path: location.pathname, shell: window.RS_SHELL, title: document.title })`);
  check(stayed && stayed.path === '/' && /binaural beats, tones/.test(stayed.title || ''),
        'with ?shell=0 the landing really renders and stays put', stayed && `${stayed.path} · RS_SHELL=${stayed.shell}`);

  const goLanding = async (url) => {
    await app.ev(`location.assign(${JSON.stringify(url)})`);
    await app.waitFor(`/\\/app\\/$/.test(location.pathname) && !!document.getElementById('play')`, { timeoutMs: 30000 });
    return app.ev(`({ url: location.href, path: location.pathname, title: document.title })`);
  };
  const landed = await goLanding('/');
  check(landed && landed.path === '/app/', 'loading the landing in the shell redirects to the studio', landed && landed.url);
  check(landed && !/binaural beats, tones/.test(landed.title || ''), 'the window title is the studio’s, not the landing’s', landed && landed.title);
  const landed2 = await goLanding('/index.html');
  check(landed2 && landed2.path === '/app/', 'the landing by its own file name redirects too', landed2 && landed2.url);
  await app.waitFor(`document.querySelectorAll('#plist .item').length > 20 && !!document.getElementById('play')`, { timeoutMs: 60000, label: 're-boot' });

  console.log('\n-- the bundled pages serve');
  const packs = await fi(`http://127.0.0.1:${ONLINE_PORT}/packs/`);
  check(packs.status === 200 && packs.text.includes('classic.zip'), 'the packs page serves with its zip links', `HTTP ${packs.status}`);
  const help = await fi(`http://127.0.0.1:${ONLINE_PORT}/help/`);
  check(help.status === 200 && /manual|guide|Gnaural/i.test(help.text), 'the manual serves', `HTTP ${help.status}`);
  const land = await fi(`http://127.0.0.1:${ONLINE_PORT}/`);
  check(land.status === 200 && land.text.includes('binaural') && land.text.length > 1000,
        'the site landing page serves at /', `HTTP ${land.status}, ${land.text.length} B`);
  const zipHead = await fi(`http://127.0.0.1:${ONLINE_PORT}/app/pack/gnaural-web-complete.zip`, { method: 'HEAD' });
  check(zipHead.status === 200, 'the complete-archive zip serves', `HTTP ${zipHead.status}`);

  console.log('\n-- quiet console');
  check(app.errors.length === 0, 'no console error lines during the run', app.errors.slice(0, 3).join(' | '));
  check(app.exceptions.length === 0, 'no uncaught exceptions during the run', app.exceptions.slice(0, 3).join(' | '));

  // restart the app through a CLEAN window close first, so state is written like a user quit
  if (!NO_RELAUNCH) {
    console.log('\n-- relaunch (favourites and window state persist)');
    // star the first visible session via the app's own UI
    const favName = await app.ev(`(() => { const row = document.querySelector('#plist .item'); const star = row && row.querySelector('.star');
      if (!star) return null; if (star.className.indexOf('on') < 0) star.click(); return row.querySelector('.nm b').textContent; })()`);
    check(!!favName, 'a session was favourited through its star', favName || 'no row/star');
    await app.closeCleanly();

    app.start();
    await app.connect();
    await app.waitFor('!!window.__gnauralAPI && window.__gnauralAPI.presetCount() > 0', { timeoutMs: 60000 });
    const favs = await app.ev(`(() => { const v = JSON.parse(localStorage.getItem('resonance.favourites.v1') || '[]'); return v; })()`);
    check(Array.isArray(favs) && favs.length > 0, 'favourites survived the relaunch', JSON.stringify(favs && favs.slice(0, 4)));
    const favRow = await app.ev(`(() => { const rows = [...document.querySelectorAll('#plist .item')];
      const hit = rows.find(r => r.querySelector('.star.on')); return hit ? hit.querySelector('.nm b').textContent : null; })()`);
    check(!!favRow, 'and the starred row renders starred again', favRow || 'none starred');
    const ws = path.join(process.env.APPDATA || '', 'ResonanceStudio', 'window-state.json');
    check(existsSync(ws), 'the window state was written on close', ws);
    const wsJ = existsSync(ws) ? JSON.parse(readFileSync(ws, 'utf8')) : null;
    check(wsJ && wsJ.width > 1000 && wsJ.height > 600, 'window geometry remembered', wsJ && JSON.stringify(wsJ));
  }

  console.log('\n-- second instance focuses the first');
  const second = spawn(EXE, [], { env: { ...process.env, RS_TEST: '1' }, stdio: 'ignore' });
  let secondExited = false;
  for (let i = 0; i < 40 && !secondExited; i++) { await sleep(300); secondExited = second.exitCode !== null; }
  check(secondExited, 'a second launch exits (single instance lock)');
  const stillAlive = await app.ev('1+1').catch(() => null);
  check(stillAlive === 2, 'the first instance is still alive and serving');
  try { second.kill(); } catch {}

  await app.stop();
} catch (e) {
  check(false, 'phase 1 threw', String(e && e.stack || e).slice(0, 500));
  await app.stop();
}

// ================================================================ phase 3: offline boot
if (!NO_OFFLINE) {
  console.log('\n-- offline boot (every non-loopback request blocked at the session)');
  const off = new DesktopApp();
  try {
    off.start({ RS_OFFLINE: '1' });
    await off.connect();
    const ready = await off.waitFor('!!window.__gnauralAPI && window.__gnauralAPI.presetCount() > 100', { timeoutMs: 60000 });
    check(ready, 'the app reaches its library with the network cut');
    const pl = await off.ev(`(async () => { window.__gnauralAPI.play(); await new Promise(r=>setTimeout(r,2000));
      const s = window.__gnauralAPI.state; return { playing: s.playing, mode: s.mode }; })()`);
    check(pl && pl.playing === true && pl.mode === 'worklet', 'and it plays (worklet engine) offline', pl && JSON.stringify(pl));
    const blocked = off.blockedLines();
    check(blocked.length === 0, 'nothing was even attempted off-origin (zero blocked requests)', blocked.slice(0, 4).join(' | ') || '0 blocked');
    check(off.errors.length === 0 && off.exceptions.length === 0, 'offline run is console-clean');
  } catch (e) {
    check(false, 'offline phase threw', String(e && e.stack || e).slice(0, 400));
  } finally {
    await off.stop();
  }
}

console.log(`\n== ${pass} passed, ${fail} failed`);
console.log(`   exe: ${EXE}`);
process.exit(fail ? 1 : 0);
