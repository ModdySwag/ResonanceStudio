#!/usr/bin/env python3
"""Resonance Studio -> Windows installer. One script, the whole ladder:

  verify the frozen app tree  ->  assemble the payload  ->  stage the Electron runtime  ->
  stamp the exe (icon + version info)  ->  compile the Inno Setup installer  ->  hash what came out.

Every step is an assertion, not a hope: every shipped file of site/resonance must hash to the
sha pinned in version.json (the tree that passed the app's own battery, plus the desktop suite),
and the staged copy is re-hashed inside the package. If those fail, nothing is built.

Usage:
    py -3.11 tools/build_windows.py                 # full build -> windows/out/
    py -3.11 tools/build_windows.py --stage-only    # stop after windows/stage/ (dev runs)
    py -3.11 tools/build_windows.py --skip-inno     # stage + tree, no installer
    py -3.11 tools/build_windows.py --no-stamp      # skip rcedit (icon/version metadata)
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
WIN = os.path.normpath(os.path.join(HERE, ".."))          # windows/
WMH = os.path.normpath(os.path.join(WIN, ".."))           # webmusic-hub/
SITE = os.path.join(WMH, "site", "resonance")             # the app source of truth
VERSION = json.load(open(os.path.join(WIN, "version.json"), encoding="utf-8"))

PAYLOAD = os.path.join(WIN, "payload")
STAGE = os.path.join(WIN, "stage", "ResonanceStudio")
OUT = os.path.join(WIN, "out")
ISCC = os.path.expandvars(r"%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe")
RCEDIT = os.path.join(WIN, "tools", "npm", "node_modules", "rcedit", "bin", "rcedit-x64.exe")
ELECTRON_CACHE = os.path.join(os.environ.get("LOCALAPPDATA", ""), "electron", "Cache")

EXE_NAME = "ResonanceStudio.exe"


def sha256(path, buf=1 << 20):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            b = f.read(buf)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


def scan_tree(root):
    files = {}
    for dirpath, _dirs, filenames in os.walk(root):
        for fn in filenames:
            if fn.endswith(".test.js"):
                continue
            p = os.path.join(dirpath, fn)
            files[os.path.relpath(p, root).replace(os.sep, "/")] = sha256(p)
    return files


def rollup(files):
    body = "\n".join(f"{rel}:{files[rel]}" for rel in sorted(files))
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def numeric_version(v):
    """The digits-only form the fixed version fields require: "1.0a" -> "1.0.0.0"."""
    parts = (re.findall(r"\d+", v) + ["0", "0", "0", "0"])[:4]
    return ".".join(parts)


def say(step, msg):
    print(f"[{step}] {msg}", flush=True)


def run(cmd, **kw):
    say("run", " ".join(str(c) for c in cmd))
    r = subprocess.run(cmd, **kw)
    if r.returncode != 0:
        raise SystemExit(f"command failed ({r.returncode}): {cmd}")
    return r


# ------------------------------------------------------------------ 1. verify the app tree
def verify_app():
    files = scan_tree(SITE)
    pinned = VERSION.get("appTree", {})
    if not pinned:
        raise SystemExit("REFUSING TO BUILD: version.json has no appTree pin — run tools/make_version.py")
    missing = [rel for rel in pinned if rel not in files]
    changed = [rel for rel in pinned if rel in files and files[rel] != pinned[rel]]
    extra = [rel for rel in files if rel not in pinned]
    if missing or changed or extra:
        raise SystemExit(
            "REFUSING TO BUILD: site/resonance is not the frozen tree.\n"
            f"  missing {len(missing)}: {missing[:8]}\n"
            f"  changed {len(changed)}: {changed[:8]}\n"
            f"  new     {len(extra)}: {extra[:8]}\n"
            "Run the app's battery on the change, then tools/make_version.py, in the same pass."
        )
    got = rollup(files)
    if got != VERSION["appBuildSha256"]:
        raise SystemExit(f"REFUSING TO BUILD: rollup drift ({got[:16]}... vs pinned {VERSION['appBuildSha256'][:16]}...)")
    total = sum(os.path.getsize(os.path.join(SITE, rel)) for rel in files)
    if total != VERSION["appBuildBytes"]:
        raise SystemExit(f"REFUSING TO BUILD: bytes {total} != pinned {VERSION['appBuildBytes']}")
    say("verify", f"frozen tree OK: {len(files)} files · {total:,} B · build {VERSION['appBuild']} · rollup {got[:16]}...")


# ---------------------------------------------------------------------------- 2. the payload
def assemble_payload():
    if os.path.isdir(PAYLOAD):
        shutil.rmtree(PAYLOAD)
    os.makedirs(os.path.join(PAYLOAD, "icons"))

    # the whole shipped site tree, byte for byte (tests are excluded by scan_tree)
    for rel in VERSION["appTree"]:
        src = os.path.join(SITE, rel)
        dst = os.path.join(PAYLOAD, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(src, dst)

    # the shell + product files
    for src, dst in ((os.path.join(WIN, "app", "main.js"), "main.js"),
                     (os.path.join(WIN, "app", "preload.js"), "preload.js"),
                     (os.path.join(WIN, "product", "COPYING"), "COPYING"),
                     (os.path.join(WIN, "product", "COPYING.LESSER"), "COPYING.LESSER"),
                     (os.path.join(WIN, "product", "NOTICE.txt"), "NOTICE.txt"),
                     (os.path.join(WIN, "product", "README.md"), "readme.md")):
        shutil.copy2(src, os.path.join(PAYLOAD, dst))
    icon_src = os.path.join(WIN, "icons", "resonancestudio.ico")
    if not os.path.exists(icon_src):
        import make_icon
        make_icon.build()
    shutil.copy2(icon_src, os.path.join(PAYLOAD, "icons", "resonancestudio.ico"))

    pkg = {
        "name": "resonance-studio",
        "productName": "Resonance Studio",
        "version": VERSION["version"],
        "description": "Resonance Studio — a tone, beat and noise studio (desktop).",
        "main": "main.js",
        "author": {"name": "Modtech (Moddy)", "email": VERSION["authorEmail"]},
        "license": VERSION["license"],
        "homepage": VERSION["appPage"],
        "private": True,
    }
    with open(os.path.join(PAYLOAD, "package.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(pkg, f, indent=2, ensure_ascii=False)
        f.write("\n")

    build_info = {
        "name": VERSION["name"],
        "appId": VERSION["appId"],
        "version": VERSION["version"],
        "appBuild": VERSION["appBuild"],
        "appBuildBytes": VERSION["appBuildBytes"],
        "appBuildSha256": VERSION["appBuildSha256"],
        "appTreeFiles": VERSION["appTreeFiles"],
        "appBuildNote": VERSION.get("appBuildNote", ""),
        "electron": VERSION["electron"],
        "builtAt": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    with open(os.path.join(PAYLOAD, "build-info.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(build_info, f, indent=2, ensure_ascii=False)
        f.write("\n")
    say("payload", f"assembled: site tree ({VERSION['appTreeFiles']} files) + shell + product files")


# ----------------------------------------------------------------------- 3. the Electron tree
def find_electron_zip():
    want = f"electron-v{VERSION['electron']}-win32-x64.zip"
    hits = []
    for root, _dirs, files in os.walk(ELECTRON_CACHE):
        if want in files:
            hits.append(os.path.join(root, want))
    if not hits:
        raise SystemExit(
            f"Electron runtime {want} is not in the cache ({ELECTRON_CACHE}).\n"
            f"Fetch it once: npm install electron@{VERSION['electron']} --no-save  (in a temp dir), "
            "or set ELECTRON_CACHE to a folder that has it."
        )
    return max(hits, key=os.path.getmtime)


def stage_runtime():
    zip_path = find_electron_zip()
    say("stage", f"runtime: {zip_path} ({os.path.getsize(zip_path):,} B)")
    if os.path.isdir(STAGE):
        shutil.rmtree(STAGE)
    os.makedirs(os.path.dirname(STAGE), exist_ok=True)
    with zipfile.ZipFile(zip_path) as z:
        z.extractall(STAGE)
    default_app = os.path.join(STAGE, "resources", "default_app.asar")
    if os.path.exists(default_app):
        os.remove(default_app)
    exe = os.path.join(STAGE, "electron.exe")
    if not os.path.exists(exe):
        raise SystemExit("stage: electron.exe missing after extraction")
    os.rename(exe, os.path.join(STAGE, EXE_NAME))

    app_dir = os.path.join(STAGE, "resources", "app")
    if os.path.isdir(app_dir):
        shutil.rmtree(app_dir)
    shutil.copytree(PAYLOAD, app_dir)

    # the byte-fidelity proof: what is inside the staged app is the frozen tree
    for rel in VERSION["appTree"]:
        p = os.path.join(app_dir, rel)
        if not os.path.exists(p):
            raise SystemExit(f"stage: packaged file missing: {rel}")
        if sha256(p) != VERSION["appTree"][rel]:
            raise SystemExit(f"stage: packaged file differs from source: {rel}")
    say("stage", f"staged tree OK — resources/app carries the frozen {VERSION['appBuild']} tree, byte for byte")


def stamp_exe():
    if not os.path.exists(RCEDIT):
        say("stamp", f"rcedit not found at {RCEDIT} — run: (cd windows/tools/npm && npm install). Skipping stamp.")
        return False
    exe = os.path.join(STAGE, EXE_NAME)
    ico = os.path.join(WIN, "icons", "resonancestudio.ico")
    v = VERSION["version"]
    run([RCEDIT, exe,
         "--set-icon", ico,
         "--set-file-version", numeric_version(v),
         "--set-product-version", v,
         "--set-version-string", "ProductName", "Resonance Studio",
         "--set-version-string", "FileDescription", "Resonance Studio — a tone, beat and noise studio",
         "--set-version-string", "CompanyName", VERSION["publisher"],
         "--set-version-string", "LegalCopyright", VERSION["copyright"],
         "--set-version-string", "OriginalFilename", EXE_NAME,
         "--set-version-string", "InternalName", "ResonanceStudio"])
    say("stamp", f"exe stamped: icon + Resonance Studio {v} metadata")
    return True


# ------------------------------------------------------------------------- 4. the installer
def build_installer():
    if not os.path.exists(ISCC):
        raise SystemExit(f"Inno Setup compiler not found at {ISCC}")
    os.makedirs(OUT, exist_ok=True)
    iss = os.path.join(WIN, "installer", "resonancestudio.iss")
    run([ISCC, f"/DAppVersion={VERSION['version']}",
         f"/DVersionInfoVersion={numeric_version(VERSION['version'])}",
         f"/DAppBuild={VERSION['appBuild']}", iss],
        cwd=os.path.join(WIN, "installer"))
    setup = os.path.join(OUT, f"ResonanceStudio-Setup-{VERSION['version']}.exe")
    if not os.path.exists(setup):
        raise SystemExit("installer build reported success but the Setup exe is not there")
    return setup


def report(setup):
    exe = os.path.join(STAGE, EXE_NAME)
    tree_bytes = 0
    for root, _d, files in os.walk(STAGE):
        for f in files:
            tree_bytes += os.path.getsize(os.path.join(root, f))
    setup_sha, setup_bytes = sha256(setup), os.path.getsize(setup)
    manifest = {
        "product": VERSION["name"],
        "version": VERSION["version"],
        "appBuild": VERSION["appBuild"],
        "appSha256": VERSION["appBuildSha256"],
        "appTreeFiles": VERSION["appTreeFiles"],
        "electron": VERSION["electron"],
        "setup": os.path.basename(setup),
        "setupBytes": setup_bytes,
        "setupSha256": setup_sha,
        "installedTreeBytes": tree_bytes,
        "installedExeSha256": sha256(exe),
        "builtAt": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    with open(os.path.join(OUT, "build-manifest.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
        f.write("\n")
    with open(os.path.join(OUT, f"ResonanceStudio-Setup-{VERSION['version']}.sha256.txt"), "w", encoding="utf-8", newline="\n") as f:
        f.write(f"{setup_sha}  {os.path.basename(setup)}\n")
    say("report", f"Setup    {setup_bytes:,} B  sha256 {setup_sha}")
    say("report", f"installs {tree_bytes:,} B ({tree_bytes / setup_bytes:.1f}x unpacked)")
    say("report", f"manifest {os.path.join(OUT, 'build-manifest.json')}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage-only", action="store_true")
    ap.add_argument("--skip-inno", action="store_true")
    ap.add_argument("--no-stamp", action="store_true")
    a = ap.parse_args()

    verify_app()
    assemble_payload()
    stage_runtime()
    if not a.no_stamp:
        stamp_exe()
    say("stage", f"runnable tree: {STAGE}")
    if a.stage_only:
        return
    if a.skip_inno:
        return
    setup = build_installer()
    report(setup)


if __name__ == "__main__":
    main()
