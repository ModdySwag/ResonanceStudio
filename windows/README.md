# Resonance Studio — Windows build (windows/)

This directory is the Windows packaging project for the Resonance Studio web app, which itself
lives (and is maintained) at `../site/resonance/`. The build wraps that tree, byte for byte, in an
Electron shell and compiles a per-user Inno Setup installer.

    version.json              pins the frozen app tree (one sha256 per file + rollup)
    app/main.js               the Electron shell (loopback origin, downloads, menu, test hooks)
    app/preload.js            __RS_DESKTOP marker + RS_SHARE_BASE for share links
    installer/resonancestudio.iss   the Inno Setup script (per-user, keeps your data)
    icons/                    resonancestudio.ico + PNGs (tools/make_icon.py draws them)
    tools/make_version.py     freeze site/resonance -> version.json (run after ANY app change)
    tools/build_windows.py    verify -> payload -> stage Electron -> stamp -> Inno -> hashes
    tools/install_journey.py  install -> checks -> upgrade -> uninstall, all asserted
    tools/take_desktop_shots.mjs  the downloads-page screenshots, from the installed app
    tools/sync_github.py      assemble github/ (the public repo working copy)
    verify/test_desktop_app.mjs   the desktop suite (57 checks; CDP against the real exe)
    product/                  licence files + the readmes that ship with the app and source
    out/ stage/ payload/ shots/ tmp/   build artifacts (never published as-is)

Order of operations for a release:

    py -3.11 tools/make_version.py          # AFTER the app's own node suites are green
    py -3.11 tools/build_windows.py         # writes out/ResonanceStudio-Setup-<v>.exe
    py -3.11 tools/install_journey.py       # install -> CDP suite -> upgrade -> uninstall
    node tools/take_desktop_shots.mjs       # screenshots from the installed build
    python3 ../../radio-browser/make-resonance-assets.py   # hub files + source zip

The build REFUSES to run when site/resonance does not match version.json — that is the point:
what ships is what was tested, byte for byte, and the journey re-hashes every file inside the
installed copy.

Env hooks used by the harnesses (harmless in normal use): RS_TEST=1 (mute), RS_DEBUG_PORT=n
(CDP), RS_DL_DIR=<dir> (auto-save downloads), RS_OFFLINE=1 (block all non-loopback traffic),
RS_PORT=n (loopback port preference).
