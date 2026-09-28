; Resonance Studio — Windows installer (Inno Setup 6).
;
; Built by windows/tools/build_windows.py:
;     ISCC /DAppVersion=<version.json version> /DVersionInfoVersion=<its numeric form>
;          /DAppBuild=<frozen app build> resonancestudio.iss
;
; The payload is the staged Electron tree at ..\stage\ResonanceStudio — the Electron runtime with
; resources\app\ holding the FROZEN site tree. The build script proves every file inside the staged
; tree hashes to the pin in version.json before this script ever runs.
;
; Per-user install (no UAC), Add/Remove entry, licence page (GPL-2.0-or-later, engine
; LGPL-2.1-or-later), silent-friendly (/VERYSILENT), and an uninstall that offers — never forces —
; removing your library, packs and settings.

#define AppName "Resonance Studio"
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef AppBuild
  #define AppBuild "unknown"
#endif
; The exe's fixed version info takes digits only, so build_windows.py passes the numeric form
; of the version separately ("1.0a" -> "1.0.0.0"). AppVersion / AppVerName keep the 1.0a label
; the user sees; VersionInfoProductVersion is deliberately NOT set, so it defaults to AppVersion.
#ifndef VersionInfoVersion
  #define VersionInfoVersion "0.0.0.0"
#endif
#define AppPublisher "Modtech"
#define AppURL "https://moddys.net/resonance/"
#define ReleasesURL "https://moddys.net/moddys-downloads.html"
#define ExeName "ResonanceStudio.exe"

[Setup]
; Stable AppId for the life of the product — changing it would orphan every existing install.
AppId={{118B7A31-934E-45BC-99E1-B303670D2D37}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
AppSupportURL={#ReleasesURL}
AppUpdatesURL={#ReleasesURL}
VersionInfoVersion={#VersionInfoVersion}
VersionInfoCompany={#AppPublisher}
VersionInfoDescription={#AppName} {#AppVersion} setup (app build {#AppBuild})
VersionInfoProductName={#AppName}
DefaultDirName={autopf}\Resonance Studio
DefaultGroupName=Resonance Studio
DisableProgramGroupPage=yes
LicenseFile=..\product\COPYING
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir=..\out
OutputBaseFilename=ResonanceStudio-Setup-{#AppVersion}
SetupIconFile=..\icons\resonancestudio.ico
UninstallDisplayIcon={app}\{#ExeName}
UninstallDisplayName={#AppName}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
AllowNoIcons=yes
CloseApplications=yes
RestartApplications=no
; The app keeps everything under %APPDATA%\ResonanceStudio — the installer never writes there, so
; upgrades over the top leave favourites, installed packs and settings exactly where they were.
UsePreviousAppDir=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Shortcuts:"

[Files]
; the whole Electron tree, payload included
Source: "..\stage\ResonanceStudio\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\Resonance Studio"; Filename: "{app}\{#ExeName}"
Name: "{autodesktop}\Resonance Studio"; Filename: "{app}\{#ExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#ExeName}"; Description: "Launch Resonance Studio"; Flags: nowait postinstall skipifsilent

[Code]
{ Uninstall: the app folder goes, your library stays unless you say otherwise. Favourites,
  imported packs and the window layout live in %APPDATA%\ResonanceStudio — deleting a listening
  tool's saved library by default is not a thing a polite installer does. }
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  DataDir: String;
  Keep: Integer;
begin
  if CurUninstallStep = usPostUninstall then
  begin
    DataDir := ExpandConstant('{userappdata}\ResonanceStudio');
    if DirExists(DataDir) then
    begin
      Keep := MsgBox('Also delete your Resonance Studio favourites, imported packs and settings?' + #13#10#13#10 +
                     DataDir + #13#10#13#10 +
                     'Choose No to keep them (installing again picks up where you left off).',
                     mbConfirmation, MB_YESNO or MB_DEFBUTTON2);
      if Keep = IDYES then
        DelTree(DataDir, True, True, True);
    end;
  end;
end;
