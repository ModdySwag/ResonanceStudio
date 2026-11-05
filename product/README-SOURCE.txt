Resonance Studio 1.0f - source and licences
=========================================

This package is the corresponding source for the Resonance Studio 1.0f Windows build, as offered
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
  README.md, RELEASE-NOTES-1.0f.md, COPYING, COPYING.LESSER, NOTICE.txt

BUILDING
--------
  (needs: node >= 21, python 3.11 with Pillow, Inno Setup 6, the Electron 40.10.2 runtime)
  py -3.11 windows/tools/make_version.py       # re-freeze the app tree (after a change + green suites)
  py -3.11 windows/tools/build_windows.py      # verifies the pin, stages Electron, compiles the Setup
  py -3.11 windows/tools/install_journey.py    # install -> desktop suite -> upgrade -> uninstall

HASH LEDGER (built 2026-11-06 03:42)
----------
  dc6e9000f4ba4da23249f600cbfc809fb8858d8380a044408d273055e8bfa9c0  ResonanceStudio-Setup-1.0f.exe
  36cb7857e4fe41e7823f94d30ee25c5a612188b56d9354ff18fd3500e544643d  ResonanceStudio-Setup-1.0f.exe.zip  (the file the downloads page serves)
  fa4700e40a45af8e6c654264d622474c4c2d65a53f0ab9ac196d108e7a6b5425  frozen app tree rollup (build fa4700e4, 58 files, 2,129,233 bytes)

The installed program at %LOCALAPPDATA%\Programs\Resonance Studio carries exactly that frozen
tree under resources/app — the install journey re-hashes every file to prove it.
