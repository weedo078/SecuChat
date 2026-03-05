; Custom NSIS installer script for SecuChat
; Requests admin privileges and adds Windows Defender exclusions for i2pd.exe
; BEFORE file extraction so Defender cannot flag it as a false positive.
; (i2pd is a legitimate open-source I2P router: https://i2pd.website)

; Require admin privileges — triggers Windows UAC prompt automatically
RequestExecutionLevel admin

!macro customHeader
  !include "LogicLib.nsh"
!macroend

!macro customInit
  ; Verify we actually have admin rights before proceeding
  UserInfo::GetAccountType
  Pop $0
  ${If} $0 != "admin"
    MessageBox MB_ICONSTOP|MB_OK "SecuChat muss als Administrator installiert werden.$\n$\nDies ist notwendig, damit Windows Defender-Ausnahmen f${\"u}r i2pd (den I2P-Router) gesetzt werden k${\"o}nnen, welcher sonst f${\"a}lschlicherweise als Bedrohung erkannt wird.$\n$\nBitte Rechtsklick auf den Installer → 'Als Administrator ausf${\"u}hren'."
    SetErrorLevel 740
    Quit
  ${EndIf}

  ; *** CRITICAL: Set Defender exclusions BEFORE file extraction ***
  ; Process exclusion for i2pd.exe — path-independent, takes effect immediately
  ExecWait 'powershell.exe -NonInteractive -ExecutionPolicy Bypass -Command \
    "Add-MpPreference -ExclusionProcess \"i2pd.exe\" -ErrorAction SilentlyContinue"'

  ; Path exclusion for the installation directory (default path, before files land)
  ExecWait 'powershell.exe -NonInteractive -ExecutionPolicy Bypass -Command \
    "Add-MpPreference -ExclusionPath \"$INSTDIR\" -ErrorAction SilentlyContinue"'
!macroend

!macro customInstall
  ; Re-apply path exclusion with the actual install directory
  ; (user may have changed it from the default set in customInit)
  ExecWait 'powershell.exe -NonInteractive -ExecutionPolicy Bypass -Command \
    "Add-MpPreference -ExclusionPath \"$INSTDIR\" -ErrorAction SilentlyContinue"'

  ; AppData exclusion for i2pd runtime data and logs
  ExecWait 'powershell.exe -NonInteractive -ExecutionPolicy Bypass -Command \
    "Add-MpPreference -ExclusionPath \"$APPDATA\securechat\" -ErrorAction SilentlyContinue"'
!macroend

!macro customUnInstall
  ExecWait 'powershell.exe -NonInteractive -ExecutionPolicy Bypass -Command \
    "Remove-MpPreference -ExclusionProcess \"i2pd.exe\" -ErrorAction SilentlyContinue"'

  ExecWait 'powershell.exe -NonInteractive -ExecutionPolicy Bypass -Command \
    "Remove-MpPreference -ExclusionPath \"$INSTDIR\" -ErrorAction SilentlyContinue"'

  ExecWait 'powershell.exe -NonInteractive -ExecutionPolicy Bypass -Command \
    "Remove-MpPreference -ExclusionPath \"$APPDATA\securechat\" -ErrorAction SilentlyContinue"'
!macroend
