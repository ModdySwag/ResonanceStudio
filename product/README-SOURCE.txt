Resonance Studio 1.0a - source and licences
=========================================

This package is the corresponding source for the Resonance Studio 1.0a Windows build, as offered
at moddys.net/moddys-downloads.html and on GitHub.

THE APPLICATION
---------------
Resonance Studio is a tone, beat and noise studio: binaural beats, monaural beats, isochronic
pulses and noise beds, with 124 ready sessions in 18 packs. The desktop build is the web
application (site/) wrapped in an Electron shell (windows/app/) and packaged by
windows/tools/build_windows.py into an Inno Setup installer (windows/installer/).

It is a browser re-implementation of Gnaural's scheduling engine and .gnaural format.
Gnaural is Copyright (C) Bret Logan and contributors. This port is an independent work by
Modtech (Moddy), GPL-2.0-or-later, with the engine (site/app/engine.js) under LGPL-2.1-or-later,
and is not affiliated with the upstream project.

LAYOUT
------
  site/            the web application source (app/, help/, packs/, credits/, landing, site.css)
  windows/         the Windows packaging project (shell, installer, tools, verification, version.json)
  product/         this file
  README.md, RELEASE-NOTES-1.0a.md, COPYING, COPYING.LESSER, NOTICE.txt

BUILDING
--------
  (needs: node >= 21, python 3.11 with Pillow, Inno Setup 6, the Electron 40.10.2 runtime)
  py -3.11 windows/tools/make_version.py       # re-freeze the app tree (after a change + green suites)
  py -3.11 windows/tools/build_windows.py      # verifies the pin, stages Electron, compiles the Setup
  py -3.11 windows/tools/install_journey.py    # install -> desktop suite -> upgrade -> uninstall

HASH LEDGER (built 2026-09-28 22:23)
----------
  93310403af600c95f15dcc7a6219d64be2c32b0ee304250a91daa78322430faa  ResonanceStudio-Setup-1.0a.exe
  66e11a71257ea7cabe0ac7789aa14da8b6de485af560fd803f879913afd8c591  ResonanceStudio-Setup-1.0a.exe.zip  (the file the downloads page serves)
  5b838c82520d3681e52e71ca6a9c420eba1f71c3b29ac0aa4999cff24b0867d4  frozen app tree rollup (build 5b838c82, 43 files, 791,037 bytes)

The installed program at %LOCALAPPDATA%\Programs\Resonance Studio carries exactly that frozen
tree under resources/app — the install journey re-hashes every file to prove it.
