#!/usr/bin/env python3
"""Freeze the Resonance Studio app tree into windows/version.json.

The desktop payload ships the WHOLE resonance site tree (landing, studio, manual, packs,
credits) minus the *.test.js files, which are source-tooling and never ship. This script walks
that tree, records one sha256 per file plus a rollup hash, and writes them into version.json:
appBuild (short rollup), appBuildBytes (total), appBuildSha256 (rollup), appTree (per file).

Re-run it after ANY change to site/resonance, in the same pass that ran the app's test battery.
build_windows.py refuses to build when the tree does not match what is pinned here.

Usage:
    py -3.11 tools/make_version.py                  # update version.json
    py -3.11 tools/make_version.py --check          # verify only, nonzero on drift
    py -3.11 tools/make_version.py --note "text"    # refresh the build note too
"""
import argparse, hashlib, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
WIN = os.path.normpath(os.path.join(HERE, ".."))
SITE = os.path.normpath(os.path.join(WIN, "..", "site", "resonance"))
VJSON = os.path.join(WIN, "version.json")


def sha256(path, buf=1 << 20):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(buf), b""):
            h.update(chunk)
    return h.hexdigest()


def scan():
    files = {}
    for dirpath, _dirs, filenames in os.walk(SITE):
        for fn in filenames:
            if fn.endswith(".test.js"):
                continue
            p = os.path.join(dirpath, fn)
            rel = os.path.relpath(p, SITE).replace(os.sep, "/")
            files[rel] = sha256(p)
    return files


def rollup(files):
    body = "\n".join(f"{rel}:{files[rel]}" for rel in sorted(files))
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--note", default=None)
    a = ap.parse_args()

    files = scan()
    total = sum(os.path.getsize(os.path.join(SITE, rel)) for rel in files)
    rolled = rollup(files)
    v = json.load(open(VJSON, encoding="utf-8"))

    drift = []
    for rel, h in sorted(files.items()):
        if v.get("appTree", {}).get(rel) != h:
            drift.append(rel)
    for rel in sorted(set(v.get("appTree", {})) - set(files)):
        drift.append(rel + " (gone)")

    if a.check:
        if drift or v.get("appBuildSha256") != rolled:
            print("DRIFT — the tree is not what version.json pins:")
            for rel in drift[:40]:
                print("   ", rel)
            print(f"   rollup pinned {v.get('appBuildSha256', '?')[:16]}… now {rolled[:16]}…")
            return 1
        print(f"OK — {len(files)} files match the frozen manifest (rollup {rolled[:16]}…)")
        return 0

    v["appBuild"] = rolled[:8]
    v["appBuildBytes"] = total
    v["appBuildSha256"] = rolled
    v["appTree"] = dict(sorted(files.items()))
    v["appTreeFiles"] = len(files)
    if a.note is not None:
        v["appBuildNote"] = a.note
    with open(VJSON, "w", encoding="utf-8", newline="\n") as f:
        json.dump(v, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(f"frozen: {len(files)} files, {total:,} bytes, build {v['appBuild']} (rollup {rolled[:16]}…)")
    if drift:
        print(f"note: {len(drift)} file(s) changed vs the previous pin")
    return 0


if __name__ == "__main__":
    sys.exit(main())
