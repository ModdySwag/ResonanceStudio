/* Resonance Studio — desktop preload.
 *
 * Two jobs, both namespaced so they cannot collide with the app's own globals
 * (the app owns __gnaural, __gnauralAPI, ResonanceViz, GnauralEngine …):
 *
 *  __RS_DESKTOP   tells the page (and the verification harness) that it is running inside the
 *                 Windows desktop shell, and which build is wrapped.
 *  RS_SHARE_BASE  the live-site base for "Copy share link" — a 127.0.0.1 URL would be useless
 *                 to paste anywhere, so the link is built against moddys.net exactly as the
 *                 browser version builds it against its own origin.
 */
'use strict';

const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('__RS_DESKTOP', {
  shell: 'resonance-desktop',
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  node: process.versions.node,
  version: process.env.RS_APP_VERSION || '',
  build: process.env.RS_APP_BUILD || '',
  platform: process.platform,
  arch: process.arch,
});

contextBridge.exposeInMainWorld('RS_SHARE_BASE', 'https://moddys.net/resonance/app/');
