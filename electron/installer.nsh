; Custom NSIS installer script for SecuChat
; Ensures admin privileges via TWO mechanisms (manifest + programmatic fallback)
; and sets Windows Defender exclusions for i2pd.exe BEFORE file extraction
; to prevent false-positive quarantine.

; --- Mechanism 1: manifest-based UAC (compile-time) ---
; Embeds requireAdministrator in the installer EXE manifest.
; Windows shows UAC prompt automatically on double-click.
; Note: electron-builder may override this with its own generated directive,
; which is why Mechanism 2 (runtime fallback) is essential.
RequestExecutionLevel admin

!macro customHeader
  !include "LogicLib.nsh"
!macroend

!macro customInit
  ; --- Mechanism 2: runtime elevation fallback ---
  ; If the manifest-based elevation was overridden or bypassed, this re-launches
  ; the installer with "runas" to trigger the UAC prompt programmatically.
  UserInfo::GetAccountType
  Pop $0
  ${If} $0 != "admin"
    ExecShell "runas" "$EXEPATH" "$CMDLINE" "" SW_SHOWNORMAL
    ${If} ${Errors}
      ; User declined elevation or UAC is disabled
      MessageBox MB_ICONSTOP|MB_OK \
        "SecuChat requires administrator privileges to install correctly.$\n$\n\
This is needed to configure Windows Defender exclusions for i2pd.exe \
(the bundled I2P router), which would otherwise be incorrectly quarantined \
as a false positive.$\n$\n\
Please right-click the installer and choose 'Run as administrator'."
    ${EndIf}
    Abort
  ${EndIf}

  ; We now have verified admin rights.
  ; Set Defender exclusions BEFORE NSIS extracts any files to disk,
  ; so i2pd.exe is never scanned without an active exclusion.

  ; Process exclusion — path-independent, takes effect immediately
  ExecWait 'powershell.exe -NonInteractive -ExecutionPolicy Bypass -Command \
    "Add-MpPreference -ExclusionProcess \"i2pd.exe\" -ErrorAction SilentlyContinue"'

  ; Path exclusion for the install directory (default value, before extraction)
  ExecWait 'powershell.exe -NonInteractive -ExecutionPolicy Bypass -Command \
    "Add-MpPreference -ExclusionPath \"$INSTDIR\" -ErrorAction SilentlyContinue"'
!macroend

!macro customInstall
  ; Refresh path exclusion with the actual install dir.
  ; (User may have changed it from the default set in customInit above.)
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
