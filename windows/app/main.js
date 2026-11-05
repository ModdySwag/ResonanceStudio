/* Resonance Studio — Windows desktop shell (Electron main process).
 *
 * Why this shape: the app is a small, fully self-contained static site (app/, help/, packs/,
 * credits/ — zero third-party URLs). Instead of file:// (where AudioWorklet and a stable
 * localStorage origin are not a given), the shell serves the exact shipped bytes over a
 * loopback HTTP server — the same origin shape (a secure context) the app lives in at
 * moddys.net/resonance. Nothing about the app is modified; the payload is the site tree,
 * byte for byte, and the build script proves the tree hashes before packaging.
 *
 * Env hooks (used by the verification harness; harmless in normal use):
 *   RS_TEST=1          mute the audio output (the graph still runs; meters still read)
 *   RS_DEBUG_PORT=n    open a CDP endpoint on 127.0.0.1:n
 *   RS_DL_DIR=<dir>    save downloads to <dir> instead of asking (test hook)
 *   RS_OFFLINE=1       drop every non-loopback request (proves what boots without network)
 *   RS_PORT=n          preferred port for the loopback server (default 47850)
 */
'use strict';

const { app, BrowserWindow, Menu, dialog, shell, session, net } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const BUILD = readJson(path.join(ROOT, 'build-info.json')) || {};
const PORT_DEFAULT = 47850;

const TEST_MUTE = process.env.RS_TEST === '1';
const OFFLINE = process.env.RS_OFFLINE === '1';
const DL_DIR = process.env.RS_DL_DIR || '';
const DEBUG_PORT = process.env.RS_DEBUG_PORT || '';
const PORT_PREF = Number(process.env.RS_PORT || PORT_DEFAULT);

function log(...parts) { console.log('[rs]', ...parts); }
function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } }

/* ---------------------------------------------------------------- the loopback server */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.zip': 'application/zip',
  '.wav': 'audio/wav',
};

/* Resolve a request path to a file inside ROOT (or null). Never escapes ROOT. */
function resolveRequestPath(urlPath) {
  let rel;
  try { rel = decodeURIComponent(urlPath.split('?')[0].split('#')[0]); }
  catch (e) { return null; }
  /* "/" is the marketing landing page, exactly as it is on the site. Serving the studio here
   * instead left every one of the app's relative refs resolving against the root (a dead page at
   * that URL, with the marketing URL in the address bar); now the landing's own script bounces a
   * shell window on to /app/ before it paints, and a browser keeps the landing. */
  if (rel === '/' || rel === '') rel = '/index.html';
  if (!rel.startsWith('/')) return null;
  const abs = path.normalize(path.join(ROOT, rel));
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) return null;
  return abs;
}

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
      const abs = resolveRequestPath(req.url || '/');
      if (!abs) { res.writeHead(403).end(); return; }
      fs.stat(abs, (err, st) => {
        if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found'); return; }
        /* a directory means its index.html — /app/ and /help/ are how the app links its own pages */
        if (st.isDirectory()) {
          const idx = path.join(abs, 'index.html');
          if (!idx.startsWith(ROOT + path.sep)) { res.writeHead(403).end(); return; }
          return serveFile(idx, res, req);
        }
        if (!st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found'); return; }
        serveFile(abs, res, req);
      });
    });
    function serveFile(abs, res, req) {
      fs.stat(abs, (err2, st2) => {
        if (err2 || !st2.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found'); return; }
        const ext = path.extname(abs).toLowerCase();
        const headers = {
          'Content-Type': MIME[ext] || 'application/octet-stream',
          'Content-Length': st2.size,
          // html/js/css can be replaced by an upgrade: never let Chromium serve a stale copy
          // from cache. Pack zips and images are versioned content, so they may cache.
          'Cache-Control': (ext === '.html' || ext === '.js' || ext === '.css') ? 'no-cache' : 'public, max-age=31536000, immutable',
        };
        res.writeHead(200, headers);
        if (req.method === 'HEAD') { res.end(); return; }
        fs.createReadStream(abs).pipe(res);
      });
    }
    server.on('error', reject);
    // a stable port keeps the app's origin — and with it localStorage and window state —
    // stable across launches. Fall back only if something else really holds it, and say so.
    let attempt = 0;
    const tryListen = () => {
      const port = PORT_PREF + attempt;
      const onError = (err) => {
        if (err && err.code === 'EADDRINUSE' && attempt < 9) {
          attempt += 1;
          log(`port ${port} busy — trying ${PORT_PREF + attempt}`);
          server.removeListener('listening', onListening);
          server.listen(PORT_PREF + attempt, '127.0.0.1');
          return;
        }
        reject(err);
      };
      const onListening = () => {
        server.removeListener('error', onError);
        const actual = server.address().port;
        if (actual !== PORT_PREF) log(`WARNING: serving on ${actual} (not ${PORT_PREF}) — another app holds the port`);
        resolve({ server, port: actual });
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, '127.0.0.1');
    };
    tryListen();
  });
}

/* ------------------------------------------------------------------------ offline mode */

/* The app itself never requests anything off-origin; RS_OFFLINE=1 is the proof run. The guard
 * exists ONLY in offline mode — normal launches are left exactly as a browser would behave.
 * With it on, everything that is not loopback is answered with a 503 and logged, so the
 * harness can count exactly what a cut-cable boot would need. NO vendored files exist to
 * except: the whole app ships in the bundle. */
function installOfflineGuard(ses) {
  if (!OFFLINE) return;
  function offlineOrFetch(request) {
    const local = /^https?:\/\/(127\.0\.0\.1|localhost)\b/.test(request.url);
    if (!local) {
      log('offline: blocked', request.url);
      return new Response('', { status: 503, statusText: 'Resonance Studio offline mode' });
    }
    return net.fetch(request, { bypassCustomProtocolHandlers: true });
  }
  ses.protocol.handle('https', offlineOrFetch);
  ses.protocol.handle('http', offlineOrFetch);
}

/* ------------------------------------------------------------------------ permissions */

/* The app asks for exactly one capability a browser prompts about — writing the share link to
 * the clipboard. A desktop app the user installed themselves should not need a second
 * click-through for its own feature, so it is granted here; everything else falls through to
 * Electron's default. Reading the clipboard back is granted for the verification harness. */
const GRANTED = new Set(['clipboard-read', 'clipboard-sanitized-write']);

function installPermissions(ses) {
  ses.setPermissionRequestHandler((wc, permission, callback) => callback(GRANTED.has(permission)));
  ses.setPermissionCheckHandler((wc, permission) => GRANTED.has(permission));
}

/* ------------------------------------------------------------------------- downloads */

/* .gnaural saves, WAV exports and pack-zip downloads all come through here. A real desktop app
 * asks where to put the file; RS_DL_DIR (a test hook) skips the dialog so the harness can hash
 * what lands. */
function installDownloads(ses) {
  ses.on('will-download', (event, item) => {
    const name = item.getFilename();
    if (DL_DIR) {
      try {
        fs.mkdirSync(DL_DIR, { recursive: true });
        item.setSavePath(path.join(DL_DIR, name));
        log(`download -> ${path.join(DL_DIR, name)}`);
      } catch (e) { log('download dir failed', String(e)); }
    } else {
      const target = dialog.showSaveDialogSync(win || undefined, {
        title: 'Save ' + name,
        defaultPath: path.join(app.getPath('downloads'), name),
      });
      if (!target) { item.cancel(); log('download cancelled by the user'); return; }
      item.setSavePath(target);
      log(`download -> ${target}`);
    }
    item.once('done', (e, state) => log(`download ${state}: ${name}`));
  });
}

/* ---------------------------------------------------------------------------- window */

function stateFile() { return path.join(app.getPath('userData'), 'window-state.json'); }

function loadWindowState() {
  const s = readJson(stateFile());
  if (!s || !Number.isFinite(s.width) || !Number.isFinite(s.height)) return null;
  return s;
}

function saveWindowState(w) {
  if (!w || w.isDestroyed() || w.isMinimized() || w.isFullScreen()) return;
  try {
    const b = w.getBounds();
    fs.writeFileSync(stateFile(), JSON.stringify({ x: b.x, y: b.y, width: b.width, height: b.height }, null, 2));
  } catch (e) { /* not fatal */ }
}

let win = null;
let childWins = [];

/* Links that are not ours must not turn the app into a browser tab; and our own pop-outs
 * (about:blank, same-origin children) stay inside. */
function wireWindow(w, port) {
  w.webContents.setWindowOpenHandler(({ url: target }) => {
    const external = /^https?:\/\//i.test(target);
    const ours = target === '' || target === 'about:blank' || target.startsWith(`http://127.0.0.1:${port}`);
    if (external && !ours) { shell.openExternal(target); return { action: 'deny' }; }
    if (!ours) return { action: 'deny' };
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        autoHideMenuBar: true,
        backgroundColor: '#16140f',
        icon: path.join(ROOT, 'icons', 'resonancestudio.ico'),
        webPreferences: { preload: path.join(ROOT, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
      },
    };
  });
  w.webContents.on('will-navigate', (event, target) => {
    if (target.startsWith(`http://127.0.0.1:${port}`)) return;
    event.preventDefault();
    if (/^https?:/i.test(target)) shell.openExternal(target);
  });
}

/* The manual and the pack list are part of the shipped tree — open them in a quiet child
 * window that behaves like the rest of the app. */
function openChild(port, relPath, title, w = 1150, h = 820) {
  const c = new BrowserWindow({
    width: w, height: h,
    title,
    backgroundColor: '#16140f',
    icon: path.join(ROOT, 'icons', 'resonancestudio.ico'),
    autoHideMenuBar: true,
    parent: win || undefined,
    webPreferences: { preload: path.join(ROOT, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  wireWindow(c, port);
  c.loadURL(`http://127.0.0.1:${port}${relPath}`);
  c.on('closed', () => { childWins = childWins.filter((x) => x !== c); });
  childWins.push(c);
  return c;
}

function createWindow(port) {
  const saved = loadWindowState();
  win = new BrowserWindow({
    width: (saved && saved.width) || 1720,     // the app's viz flanks appear past ~1560 px
    height: (saved && saved.height) || 1040,
    x: saved ? saved.x : undefined,
    y: saved ? saved.y : undefined,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#16140f',    // the forge skin's charcoal — no white flash on launch
    title: 'Resonance Studio',
    icon: path.join(ROOT, 'icons', 'resonancestudio.ico'),
    autoHideMenuBar: false,
    show: false,
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,  // an audio app must keep its clock when the window is covered
      devTools: true,
    },
  });

  win.once('ready-to-show', () => win.show());
  win.on('resize', () => saveWindowState(win));
  win.on('move', () => saveWindowState(win));
  win.on('close', () => saveWindowState(win));

  wireWindow(win, port);

  win.webContents.on('render-process-gone', (event, details) => {
    log('renderer gone:', details.reason);
    const choice = dialog.showMessageBoxSync(win, {
      type: 'error', buttons: ['Reload', 'Quit'], defaultId: 0,
      title: 'Resonance Studio', message: 'The app window stopped responding.',
      detail: 'Reason: ' + details.reason + '. Reloading rebuilds the interface — your library and favourites are kept.',
    });
    if (choice === 0) win.webContents.reload(); else app.quit();
  });

  win.loadURL(`http://127.0.0.1:${port}/app/`);
  return win;
}

/* ------------------------------------------------------------------------------ menu */

/* Deliberately accelerator-free: the studio has its own keymap (Space, S, F, [, ], ? …) and a
 * native menu item with an accelerator would shadow it in the web contents. Menu items are
 * click-only and carry only what the Windows shell owes a desktop app. */
function buildMenu(port) {
  const menu = Menu.buildFromTemplate([
    {
      label: 'Resonance Studio',
      submenu: [
        { label: 'About Resonance Studio', click: () => showAbout() },
        { label: 'Open the app data folder', click: () => shell.openPath(app.getPath('userData')) },
        { type: 'separator' },
        { label: 'Quit', click: () => app.quit() },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', click: () => win && win.webContents.reload() },
        { label: 'Toggle developer tools', click: () => win && win.webContents.toggleDevTools() },
        { type: 'separator' },
        { label: 'Toggle full screen', click: () => win && win.setFullScreen(!win.isFullScreen()) },
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'User manual', click: () => openChild(port, '/help/', 'Resonance Studio — manual') },
        { label: 'Session packs', click: () => openChild(port, '/packs/', 'Resonance Studio — packs') },
        { type: 'separator' },
        { label: 'Resonance Studio on moddys.net', click: () => shell.openExternal('https://moddys.net/resonance/') },
        { label: 'Downloads & release notes', click: () => shell.openExternal('https://moddys.net/moddys-downloads.html') },
        { type: 'separator' },
        { label: 'Licence: GPL-2.0-or-later (app) · LGPL-2.1-or-later (engine)', click: () => shell.openPath(path.join(ROOT, 'COPYING')) },
        { label: 'Engine licence (LGPL-2.1-or-later)', click: () => shell.openPath(path.join(ROOT, 'COPYING.LESSER')) },
        { label: 'Attribution & notices', click: () => shell.openPath(path.join(ROOT, 'NOTICE.txt')) },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
}

function showAbout() {
  const v = (BUILD && BUILD.version) || '?';
  const b = (BUILD && BUILD.appBuild) || '?';
  dialog.showMessageBox(win || undefined, {
    type: 'info',
    title: 'About Resonance Studio',
    message: `Resonance Studio ${v}`,
    detail: [
      `A tone, beat and noise studio — the same app as moddys.net/resonance.`,
      ``,
      `App build:  ${b} (${(BUILD && BUILD.appBuildBytes ? BUILD.appBuildBytes.toLocaleString() : '?')} bytes packed)`,
      `Electron:   ${process.versions.electron}   Chromium: ${process.versions.chrome}`,
      `Data folder: ${app.getPath('userData')}`,
      ``,
      `Gnaural Web port: GPL-2.0-or-later (engine LGPL-2.1-or-later) · © 2026 Modtech (Moddy)`,
      `Not a medical device. See the manual's safety notes.`,
    ].join('\n'),
    buttons: ['OK'],
  });
}

/* ------------------------------------------------------------------------------- boot */

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
if (TEST_MUTE) app.commandLine.appendSwitch('mute-audio');
if (DEBUG_PORT) app.commandLine.appendSwitch('remote-debugging-port', DEBUG_PORT);

app.setAppUserModelId((BUILD && BUILD.appId) || 'net.moddys.resonancestudio');

/* One fixed home for the app's data (favourites, installed packs, window state). Electron would
 * derive this from the package name; pinning it means the folder is the same whatever the
 * package metadata says, and the uninstaller's "leaves your library behind" promise is exact:
 * %APPDATA%\ResonanceStudio, never touched by the installer. */
app.setPath('userData', path.join(app.getPath('appData'), 'ResonanceStudio'));

/* the preload reads these to report which build is wrapped */
process.env.RS_APP_VERSION = (BUILD && BUILD.version) || '';
process.env.RS_APP_BUILD = (BUILD && BUILD.appBuild) || '';

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(async () => {
    let port;
    try {
      const started = await startServer();
      port = started.port;
    } catch (e) {
      dialog.showErrorBox('Resonance Studio', 'Could not start the local app server: ' + String(e));
      app.quit();
      return;
    }
    log(`serving ${ROOT} on http://127.0.0.1:${port}/`);
    log(`build ${BUILD.version || '?'} · app ${BUILD.appBuild || '?'} · electron ${process.versions.electron}`);
    installPermissions(session.defaultSession);
    installOfflineGuard(session.defaultSession);
    installDownloads(session.defaultSession);
    buildMenu(port);
    createWindow(port);
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(port); });
  });

  app.on('window-all-closed', () => app.quit());
}
