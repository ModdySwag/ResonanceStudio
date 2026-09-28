// Take the download-page screenshots from the INSTALLED Resonance Studio (not a browser, not the
// source files): launch it, drive it to each view over CDP, capture at real sizes.
//
//   node tools/take_desktop_shots.mjs                 # writes shots/desktop-*.png next to this tool
//   node tools/take_desktop_shots.mjs --exe "<path>"  # a different build
//
// Wide shots use a device-metrics override plus a resize nudge: Electron has no CDP window
// resize (Browser.getWindowForTarget is not implemented), and the app's own mount switch keys
// off a matchMedia change — the nudge drives exactly the path a real window drag would.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WIN = path.join(HERE, '..');
const argv = process.argv.slice(2);
const argVal = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const EXE = argVal('--exe', path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Resonance Studio', 'ResonanceStudio.exe'));
const PORT = Number(argVal('--cdp', '9370'));
const OUT = argVal('--out', path.join(WIN, 'shots'));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

if (!existsSync(EXE)) { console.error('no app at ' + EXE); process.exit(2); }
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

let out = '';
const proc = spawn(EXE, [], { env: { ...process.env, RS_TEST: '1', RS_DEBUG_PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
proc.stdout.on('data', d => out += d); proc.stderr.on('data', d => out += d);

let ws, id = 0; const pending = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.exceptionDetails) return { __ex: String(r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 200) }; return r.result?.value; };

try {
  let t = null;
  for (let i = 0; i < 90 && !t; i++) { try { t = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(x => x.type === 'page'); } catch {} if (!t) await sleep(1000); }
  if (!t) throw new Error('the app never opened a debug port');
  ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } };
  await send('Runtime.enable'); await send('Page.enable');
  for (let i = 0; i < 60; i++) { if (await ev('!!window.__gnauralAPI && window.__gnauralAPI.presetCount() > 0')) break; await sleep(700); }
  console.log('ready');

  const dismissChrome = () => ev(`(() => { const T = document.getElementById('toast'); if (T) T.textContent = ''; const badge = document.querySelector('.viz-badge'); return true; })()`);
  const shot = async (name) => {
    await dismissChrome();
    try { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 4, y: 4, button: 'none' }); } catch {}
    await sleep(350);
    const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const file = path.join(OUT, name + '.png');
    writeFileSync(file, Buffer.from(r.data, 'base64'));
    const inner = await ev('({ w: innerWidth, h: innerHeight })');
    console.log('shot:', file, `${inner.w}x${inner.h}`);
    return file;
  };
  const setViewport = async (w, h) => {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await sleep(500);
    await ev(`window.dispatchEvent(new Event('resize'))`);   // the app's own mount switch listens for this
    await sleep(1200);
  };
  const scrollTop = () => ev(`(() => { window.scrollTo(0, 0);
    document.querySelectorAll('.col').forEach(c => { c.scrollTop = 0; });
    const pl = document.getElementById('plist'); if (pl) pl.scrollTop = 0; return true; })()`);

  // visualizers ON, configured for a lively (but real) wide shot
  const on = await ev(`window.ResonanceViz.api.getPrefs().on`);
  if (on !== true) { await ev(`document.getElementById('vizToggle').click()`); await sleep(600); }
  await ev(`window.ResonanceViz.api.setPrefs({ backdrop: 'aurora', overlays: ['pulse', 'phasors', 'ripples'], intensity: 0.85, calm: 1 })`);
  await sleep(600);
  console.log('viz:', JSON.stringify(await ev(`window.ResonanceViz.api.getPrefs()`)));

  // 01 — the studio while a session plays (1440x900 content)
  await setViewport(1440, 900);
  await scrollTop();
  await ev(`window.__gnauralAPI.play()`);
  await sleep(3500);
  await shot('desktop-01-studio');

  // 02 — the tools: timer counting + breathing pacer running
  await ev(`(() => {
    const tp = document.getElementById('timerPane'); if (tp) tp.open = true;
    const pp = document.getElementById('pacerPane'); if (pp) pp.open = true;
    const chips = [...document.querySelectorAll('#toolpanes button')];
    const t5 = chips.find(b => b.textContent.trim() === '5 min'); if (t5) t5.click();
    const start = [...document.querySelectorAll('#pacerPane button')].find(b => /start|breathe/i.test(b.textContent));
    if (start) start.click();
    const box = document.getElementById('toolpanes');
    if (box) box.scrollIntoView({ block: 'start' });
    setTimeout(() => window.scrollBy(0, -64), 60);
    return { timer: !!t5, pacer: !!start };
  })()`);
  await sleep(4500);
  await shot('desktop-02-tools');

  // 03 — the files / export row (left column)
  await ev(`(() => { const btn = document.getElementById('saveGnm'); if (btn) btn.closest('.card').scrollIntoView({ block: 'center' }); return true; })()`);
  await sleep(1200);
  await ev(`document.getElementById('cancelTimer') && 1`);
  await ev(`window.__gnauralAPI.play()`);
  await sleep(1200);
  await shot('desktop-03-files');

  // 04 — the wide view: flank visualizers live; two moments to pick from.
  // 'score' carries the most visible motion in a 284 px strip (measured against the other
  // backdrops in a contact sheet) — the shot shows what the feature does, not a dark guess.
  await setViewport(2160, 1240);
  await scrollTop();
  await sleep(600);
  await ev(`window.ResonanceViz.api.setPrefs({ backdrop: 'score', overlays: ['pulse', 'ripples', 'traces'], intensity: 1.0, calm: 1 })`);
  await sleep(1200);
  const flanks = await ev(`[...document.querySelectorAll('[data-viz-panel]')].filter(c => c.classList.contains('viz-flank')).length`);
  console.log('flank canvases:', flanks);
  await ev(`window.__gnauralAPI.play()`);
  await sleep(5000);
  await shot('desktop-04-wide-a');
  await sleep(4000);
  await shot('desktop-04-wide-b');

  // 05 — the packs page that ships inside
  await ev(`location.href = '/packs/'`);
  await sleep(2500);
  await shot('desktop-05-packs');

  // 06 — the manual that ships inside
  await ev(`location.href = '/help/'`);
  await sleep(2500);
  await shot('desktop-06-manual');

  console.log('--- shell tail ---');
  console.log(out.split(/\r?\n/).filter(Boolean).slice(-4).join('\n'));
} catch (e) {
  console.error('shot run failed:', e && e.message);
  console.error(out.split(/\r?\n/).slice(-10).join('\n'));
  try { proc.kill(); } catch {}
  process.exit(1);
}
try { proc.kill(); } catch {}
await sleep(600);
process.exit(0);
