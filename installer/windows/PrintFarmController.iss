#ifndef MyAppVersion
  #define MyAppVersion "0.0.0-dev"
#endif

#define MyAppName "Print Farm Controller"
#define MyAppExeName "PrintFarmController.exe"

[Setup]
AppId={{8E1D9EEA-1C3A-4B20-A779-42B6F4E55D61}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} v{#MyAppVersion}
VersionInfoVersion={#MyAppVersion}
VersionInfoProductName={#MyAppName}
VersionInfoProductVersion={#MyAppVersion}
DefaultDirName={autopf}\Print Farm Controller
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\..\dist\installer
OutputBaseFilename=PrintFarmController-Setup-v{#MyAppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
SetupLogging=yes
CloseApplications=yes
RestartApplications=no
UninstallDisplayName={#MyAppName}
UninstallDisplayIcon={app}\{#MyAppExeName}
UsePreviousAppDir=yes

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: unchecked

[Dirs]
Name: "{app}\data"
Name: "{app}\logs"

[Files]
Source: "..\..\dist\windows-x64\{#MyAppExeName}"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\dist\windows-x64\ffmpeg\*"; DestDir: "{app}\ffmpeg"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\..\src\security\windows-data-permissions.ps1"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Launch {#MyAppName}"; WorkingDir: "{app}"; Flags: nowait postinstall skipifsilent

[Code]
var
  OwnerPage: TInputQueryWizardPage;
  OwnerLoaded: Boolean;

procedure InitializeWizard;
begin
  OwnerPage := CreateInputQueryPage(wpSelectDir, 'Controller Windows account',
    'Choose the Windows account that will run the controller',
    'Only this account, SYSTEM and Administrators will have access to controller data and logs. Browser users do not need Windows file access. If you elevated using another administrator account, enter the account that will launch the controller.');
  OwnerPage.Add('Windows account (DOMAIN\user or user SID):', False);
  OwnerPage.Values[0] := ExpandConstant('{param:ControllerAccount|}');
  if OwnerPage.Values[0] = '' then
    OwnerPage.Values[0] := GetPreviousData('ControllerAccount', GetEnv('USERDOMAIN') + '\' + GetUserNameString);
end;

procedure CurPageChanged(CurPageID: Integer);
var
  PreviousOwner: AnsiString;
begin
  if (CurPageID = OwnerPage.ID) and not OwnerLoaded then begin
    if (ExpandConstant('{param:ControllerAccount|}') = '') and
       LoadStringFromFile(ExpandConstant('{app}\controller-owner.sid'), PreviousOwner) then
      OwnerPage.Values[0] := Trim(String(PreviousOwner));
    OwnerLoaded := True;
  end;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if CurPageID = OwnerPage.ID then begin
    OwnerPage.Values[0] := Trim(OwnerPage.Values[0]);
    if (OwnerPage.Values[0] = '') or (Pos('"', OwnerPage.Values[0]) > 0) or
       (Pos(#13, OwnerPage.Values[0]) > 0) or (Pos(#10, OwnerPage.Values[0]) > 0) then begin
      MsgBox('Enter the individual Windows account that will run the controller.', mbError, MB_OK);
      Result := False;
    end;
  end;
end;

procedure RegisterPreviousData(PreviousDataKey: Integer);
begin
  SetPreviousData(PreviousDataKey, 'ControllerAccount', OwnerPage.Values[0]);
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ExitCode: Integer;
  Parameters: String;
  PreviousOwner: AnsiString;
begin
  if CurStep = ssPostInstall then begin
    { Silent upgrades must also retain the existing owner, not the installer identity. }
    if not OwnerLoaded and (ExpandConstant('{param:ControllerAccount|}') = '') and
       LoadStringFromFile(ExpandConstant('{app}\controller-owner.sid'), PreviousOwner) then
      OwnerPage.Values[0] := Trim(String(PreviousOwner));
    if (Trim(OwnerPage.Values[0]) = '') or (Length(OwnerPage.Values[0]) > 512) or
       (Pos('"', OwnerPage.Values[0]) > 0) or (Pos(#13, OwnerPage.Values[0]) > 0) or
       (Pos(#10, OwnerPage.Values[0]) > 0) then
      RaiseException('An individual Windows controller account is required.');
    Parameters := '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' +
      ExpandConstant('{app}\windows-data-permissions.ps1') + '" -Repair -DataDir "' +
      ExpandConstant('{app}\data') + '" -LogDir "' + ExpandConstant('{app}\logs') +
      '" -ApplicationDir "' + ExpandConstant('{app}') + '" -OwnerRecord "' +
      ExpandConstant('{app}\controller-owner.sid') + '" -Account "' + OwnerPage.Values[0] + '"';
    if not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
      Parameters, '', SW_HIDE, ewWaitUntilTerminated, ExitCode) or (ExitCode <> 0) then
      RaiseException('Controller storage permissions could not be secured. Do not launch the controller. Check the selected Windows account and use the permission-repair instructions.');
  end;
end;
