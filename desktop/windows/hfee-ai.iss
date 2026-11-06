; Inno Setup script for the Windows installer. Run after desktop/build.sh windows amd64:
;   iscc /DVersion=1.0.0 desktop\windows\hfee-ai.iss
#ifndef Version
  #define Version "1.0.0"
#endif

[Setup]
AppId={{6F1C2B9E-4A57-4C3E-9D61-2E8F0B7A5C14}
AppName=HFee AI
AppVersion={#Version}
AppPublisher=HostFog Ltd
AppPublisherURL=https://github.com/hostfog/hfee-ai
DefaultDirName={autopf}\HFee AI
DefaultGroupName=HFee AI
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\build
OutputBaseFilename=hfee-ai-{#Version}-windows-setup
SetupIconFile=..\assets\icon.ico
UninstallDisplayIcon={app}\hfee-ai.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern

[Files]
Source: "..\build\windows-amd64\hfee-ai\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion

[Icons]
Name: "{group}\HFee AI"; Filename: "{app}\hfee-ai.exe"; IconFilename: "{app}\icon.ico"
Name: "{autodesktop}\HFee AI"; Filename: "{app}\hfee-ai.exe"; IconFilename: "{app}\icon.ico"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; Flags: unchecked

[Run]
Filename: "{app}\hfee-ai.exe"; Description: "Start HFee AI"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "taskkill"; Parameters: "/F /T /IM hfee-ai.exe"; Flags: runhidden; RunOnceId: "StopHFee"
