#!/usr/bin/env python3
"""Assemble windows/github/ — the working copy of the public repository — from the sources.

Deterministic: the content (except .git) is rebuilt on every run, so the repo can never drift
from what the build froze. README.md and the release notes come from windows/github-src/;
the app tree comes from ../site/resonance (the same tree the installer ships).

Usage:  py -3.11 tools/sync_github.py
Then:   cd github && git add -A && git commit && git push
"""
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
WIN = os.path.normpath(os.path.join(HERE, ".."))
WMH = os.path.normpath(os.path.join(WIN, ".."))
SRC = os.path.join(WIN, "github-src")
GH = os.path.join(WIN, "github")
SITE = os.path.join(WMH, "site", "resonance")


def copy_file(src, rel):
    dst = os.path.join(GH, rel)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copy2(src, dst)


def main():
    # wipe everything except .git
    if os.path.isdir(GH):
        for e in os.listdir(GH):
            if e == ".git":
                continue
            p = os.path.join(GH, e)
            shutil.rmtree(p) if os.path.isdir(p) else os.remove(p)
    os.makedirs(GH, exist_ok=True)

    # root docs + licences
    copy_file(os.path.join(SRC, "README.md"), "README.md")
    copy_file(os.path.join(SRC, "RELEASE-NOTES-1.0a.md"), "RELEASE-NOTES-1.0a.md")
    copy_file(os.path.join(WIN, "product", "COPYING"), "COPYING")
    copy_file(os.path.join(WIN, "product", "COPYING.LESSER"), "COPYING.LESSER")
    copy_file(os.path.join(WIN, "product", "NOTICE.txt"), "NOTICE.txt")
    copy_file(os.path.join(WIN, "product", "README-SOURCE.txt"), "product/README-SOURCE.txt")

    # screenshots (repo copies of the release captures)
    shots_src = os.path.join(SRC, "screenshots")
    for f in sorted(os.listdir(shots_src)):
        copy_file(os.path.join(shots_src, f), f"screenshots/{f}")

    # the web application source, exactly as the build froze it
    for dirpath, _dirs, files in os.walk(SITE):
        for f in sorted(files):
            src = os.path.join(dirpath, f)
            rel = os.path.relpath(src, SITE).replace(os.sep, "/")
            copy_file(src, f"site/{rel}")

    # the Windows packaging project (sources only)
    for rel in ["README.md", "version.json", "app/main.js", "app/preload.js",
                "installer/resonancestudio.iss", "verify/test_desktop_app.mjs"]:
        copy_file(os.path.join(WIN, rel), f"windows/{rel}")
    for f in sorted(os.listdir(os.path.join(WIN, "icons"))):
        copy_file(os.path.join(WIN, "icons", f), f"windows/icons/{f}")
    for f in sorted(os.listdir(os.path.join(WIN, "tools"))):
        if f.endswith((".py", ".mjs")):
            copy_file(os.path.join(WIN, "tools", f), f"windows/tools/{f}")

    n = 0
    for _root, _d, files in os.walk(GH):
        n += len(files)
    print(f"repo assembled: {n} files -> {GH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
