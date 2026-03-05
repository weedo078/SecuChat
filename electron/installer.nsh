; Custom NSIS installer script for SecuChat
; Requests admin privileges and adds Windows Defender exclusions for i2pd.exe
; (legitimate open-source privacy tool, see https://i2pd.website —
;  flagged as false positive by some antivirus engines).

; Require admin privileges — triggers UAC prompt automatically
RequestExecutionLevel admin

!macro customHeader
  !include "LogicLib.nsh"
!macroend

!macro customInit
  ; Verify we actually have admin rights (belt-and-suspenders with UAC manifest)
  UserInfo::GetAccountType
  Pop $0
  ${If} $0 != "admin"
    MessageBox MB_ICONSTOP|MB_OK "SecuChat requires administrator privileges to install correctly.$\n$\nThis is needed to add Windows Defender exclusions for i2pd (the bundled I2P router), which is otherwise flagged as a false positive.$\n$\nPlease right-click the installer and select 'Run as administrator'."
    SetErrorLevel 740  ; ERROR_ELEVATION_REQUIRED
    Quit
  ${EndIf}
!macroend

!macro customInstall
  ; Add install directory as Defender exclusion (persistent)
  DetailPrint "Adding Windows Defender exclusion for install directory..."
  ExecWait 'powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -Command "\
    try { Add-MpPreference -ExclusionPath \"$INSTDIR\" -ErrorAction Stop } \
    catch { exit 1 }"' $0

  ; Add AppData directory as Defender exclusion (where i2pd writes data/logs)
  DetailPrint "Adding Windows Defender exclusion for app data directory..."
  ExecWait 'powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -Command "\
    $$appdataDir = Join-Path $$env:APPDATA \"securechat\"; \
    try { Add-MpPreference -ExclusionPath $$appdataDir -ErrorAction Stop } \
    catch { exit 1 }"' $0

  ; Add specific exclusion for i2pd.exe process
  DetailPrint "Adding Windows Defender exclusion for i2pd.exe process..."
  ExecWait 'powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -Command "\
    try { Add-MpPreference -ExclusionProcess \"i2pd.exe\" -ErrorAction Stop } \
    catch { exit 1 }"' $0

  DetailPrint "Windows Defender exclusions configured."
!macroend

!macro customUnInstall
  ; Remove Defender exclusion on uninstall
  ExecWait 'powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -Command "\
    try { Remove-MpPreference -ExclusionPath \"$INSTDIR\" -ErrorAction SilentlyContinue } catch {}"'

  ; Remove AppData exclusion
  ExecWait 'powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -Command "\
    $$appdataDir = Join-Path $$env:APPDATA \"securechat\"; \
    try { Remove-MpPreference -ExclusionPath $$appdataDir -ErrorAction SilentlyContinue } catch {}"'

  ; Remove process exclusion
  ExecWait 'powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -Command "\
    try { Remove-MpPreference -ExclusionProcess \"i2pd.exe\" -ErrorAction SilentlyContinue } catch {}"'
!macroend
