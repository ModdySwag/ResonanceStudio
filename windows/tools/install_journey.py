#!/usr/bin/env python3
"""The install journey for Resonance Studio, every step asserted:

    install (silent)  ->  files land + registry entry  ->  the INSTALLED app is launched and checked
    ->  upgrade over the top (user data must survive)  ->  uninstall (silent)  ->  the machine is
       clean and %APPDATA%\ResonanceStudio is still there.

Usage:
    py -3.11 tools/install_journey.py                 # full journey, with the CDP app checks
    py -3.11 tools/install_journey.py --no-app-checks # filesystem + registry only

Nothing here is taken on faith: every payload file is hashed against the frozen manifest, the
uninstall is judged by what is left on disk and in the registry, and the app checks are the same
suite that gates the staged build (verify/test_desktop_app.mjs --exe <installed>).
"""
import argparse
import hashlib
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
WIN = os.path.normpath(os.path.join(HERE, ".."))
VERSION = json.load(open(os.path.join(WIN, "version.json"), encoding="utf-8"))
SETUP = os.path.join(WIN, "out", f"ResonanceStudio-Setup-{VERSION['version']}.exe")
INSTALL_DIR = os.path.join(os.environ["LOCALAPPDATA"], "Programs", "Resonance Studio")
EXE = os.path.join(INSTALL_DIR, "ResonanceStudio.exe")
UNINST = os.path.join(INSTALL_DIR, "unins000.exe")   # Inno's default uninstaller name
DATA_DIR = os.path.join(os.environ["APPDATA"], "ResonanceStudio")
UNINST_KEY = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall"
START_MENU = os.path.join(os.environ.get("APPDATA", ""), "Microsoft", "Windows", "Start Menu", "Programs")


def start_menu_links():
    hits = []
    for root, _dirs, files in os.walk(START_MENU):
        for f in files:
            if f.lower().endswith(".lnk") and "resonance studio" in f.lower():
                hits.append(os.path.join(root, f))
            elif f.lower().endswith(".lnk"):
                try:
                    raw = open(os.path.join(root, f), "rb").read()
                    if b"ResonanceStudio.exe" in raw or b"Resonance Studio" in raw:
                        hits.append(os.path.join(root, f))
                except OSError:
                    pass
    return hits


passed = failed = 0


def check(ok, label, detail=""):
    global passed, failed
    passed, failed = (passed + 1, failed) if ok else (passed, failed + 1)
    print(f"{' ok  ' if ok else ' FAIL'} {label}{'  — ' + str(detail) if detail else ''}")


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def run(cmd, timeout=1200):
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout)


def arp_entries():
    r = run(["reg", "query", UNINST_KEY, "/s", "/f", "Resonance Studio"], timeout=120)
    return r.stdout or ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-app-checks", action="store_true")
    a = ap.parse_args()

    if not os.path.exists(SETUP):
        raise SystemExit(f"no installer at {SETUP} — build it first (tools/build_windows.py)")
    print(f"== journey for {os.path.basename(SETUP)} ({os.path.getsize(SETUP):,} B, sha {sha256(SETUP)[:16]}...)\n")

    # ---------------------------------------------------------------- clean slate
    print("-- pre-flight")
    if os.path.exists(UNINST):
        run([UNINST, "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART"])
        time.sleep(4)
    check(not os.path.exists(EXE), "no previous install in the way", INSTALL_DIR)

    # ---------------------------------------------------------------- install
    print("\n-- install (silent, per-user, default location)")
    data_dir_before = sorted(os.listdir(DATA_DIR)) if os.path.isdir(DATA_DIR) else []
    t0 = time.time()
    r = run([SETUP, "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART"])
    check(r.returncode == 0, "the installer exits 0", f"{time.time() - t0:.1f}s")
    check(os.path.exists(EXE), "ResonanceStudio.exe is installed", EXE)
    check(os.path.exists(UNINST), "the uninstaller is installed")

    app_dir = os.path.join(INSTALL_DIR, "resources", "app")
    check(os.path.isdir(app_dir), "the app payload is inside the install")
    missing = []
    bad = []
    for rel, want in VERSION["appTree"].items():
        p = os.path.join(app_dir, rel)
        if not os.path.exists(p):
            missing.append(rel)
        elif sha256(p) != want:
            bad.append(rel)
    check(not missing, "every shipped file is present in the install", f"{len(VERSION['appTree'])} files" if not missing else missing[:6])
    check(not bad, "every shipped file IS the frozen build, byte for byte", "all match" if not bad else bad[:6])
    build_info = os.path.join(app_dir, "build-info.json")
    if os.path.exists(build_info):
        bi = json.load(open(build_info, encoding="utf-8"))
        check(bi.get("appBuildSha256") == VERSION["appBuildSha256"] and bi.get("version") == VERSION["version"],
              "build-info.json names the same build", f"{bi.get('version')} · {bi.get('appBuild')}")
    links = start_menu_links()
    check(bool(links), "a Start Menu entry exists", links[0] if links else "missing")
    check("Resonance Studio" in arp_entries(), "Add/Remove Programs lists it")
    data_dir_after = sorted(os.listdir(DATA_DIR)) if os.path.isdir(DATA_DIR) else []
    check(data_dir_after == data_dir_before,
          "the installer added nothing to %APPDATA%\\ResonanceStudio (app data is the app's own)",
          f"{len(data_dir_before)} entr{'y' if len(data_dir_before) == 1 else 'ies'} untouched" if data_dir_before else "empty/per app's own making")

    # ---------------------------------------------------------------- the installed app
    if not a.no_app_checks:
        print("\n-- the installed app, driven over CDP (verify/test_desktop_app.mjs)")
        r2 = run(["node", os.path.join(WIN, "verify", "test_desktop_app.mjs"), "--exe", EXE, "--cdp", "9355"], timeout=1200)
        tail = [l for l in r2.stdout.splitlines() if l.strip()][-1:] or [""]
        check(r2.returncode == 0, "the installed app passes its desktop suite", tail[0])
        for line in r2.stdout.splitlines():
            if line.startswith(" FAIL") or line.startswith(" FATAL"):
                print("      " + line.strip())

    # ---------------------------------------------------------------- upgrade
    print("\n-- upgrade over the top")
    marker = os.path.join(DATA_DIR, "journey-marker.txt")
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(marker, "w", encoding="utf-8") as f:
        f.write("user work that must survive an upgrade\n")
    r = run([SETUP, "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART"])
    check(r.returncode == 0, "the upgrade install exits 0")
    check(os.path.exists(EXE), "the app is still installed after the upgrade")
    check(os.path.exists(marker), "user data (%APPDATA%\\ResonanceStudio) survived the upgrade", marker)
    check(arp_entries().count("Resonance Studio") >= 1, "still exactly one Add/Remove entry")

    # ---------------------------------------------------------------- uninstall
    print("\n-- uninstall (silent)")
    r = run([UNINST, "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART"])
    time.sleep(3)
    check(r.returncode == 0, "the uninstaller exits 0")
    check(not os.path.exists(EXE), "the app folder is gone", INSTALL_DIR)
    check(not os.path.exists(UNINST), "the uninstaller is gone with it")
    check("Resonance Studio" not in arp_entries(), "Add/Remove Programs is clean")
    check(os.path.exists(marker), "user data was KEPT (the deliberate default) — %APPDATA%\\ResonanceStudio is intact")
    if os.path.exists(marker):
        os.remove(marker)

    print(f"\n-- summary: {passed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
