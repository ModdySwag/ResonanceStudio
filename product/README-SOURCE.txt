Resonance Studio 1.0b - source and licences
=========================================

This package is the corresponding source for the Resonance Studio 1.0b Windows build, as offered
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
  README.md, RELEASE-NOTES-1.0b.md, COPYING, COPYING.LESSER, NOTICE.txt

BUILDING
--------
  (needs: node >= 21, python 3.11 with Pillow, Inno Setup 6, the Electron 40.10.2 runtime)
  py -3.11 windows/tools/make_version.py       # re-freeze the app tree (after a change + green suites)
  py -3.11 windows/tools/build_windows.py      # verifies the pin, stages Electron, compiles the Setup
  py -3.11 windows/tools/install_journey.py    # install -> desktop suite -> upgrade -> uninstall

HASH LEDGER (built 2026-11-04 09:36)
----------
  f2d180c8f0d7d74cda737832a12edd335965ba047497b8c4821cc2ca2576be37  ResonanceStudio-Setup-1.0b.exe
  78aae9fce26d832ffeeed2a337d79669c33861b276f87e40aa791be01653eaa2  ResonanceStudio-Setup-1.0b.exe.zip  (the file the downloads page serves)
  8383d8f334dae0d239bfdff634f18ef1ac43cd6b3d864ea3280e579d1ef7900b  frozen app tree rollup (build 8383d8f3, 56 files, 2,098,961 bytes)

The installed program at %LOCALAPPDATA%\Programs\Resonance Studio carries exactly that frozen
tree under resources/app — the install journey re-hashes every file to prove it.
