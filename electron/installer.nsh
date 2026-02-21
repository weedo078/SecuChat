; Custom NSIS installer script for SecuChat
; Adds Windows Defender exclusion for i2pd.exe (legitimate open-source
; privacy tool, see https://i2pd.website — flagged as false positive).

!macro customInstall
  ; Add install directory as Defender exclusion (persistent)
  ExecWait 'powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Add-MpPreference -ExclusionPath \"$INSTDIR\""'
!macroend

!macro customUnInstall
  ; Remove Defender exclusion on uninstall
  ExecWait 'powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Remove-MpPreference -ExclusionPath \"$INSTDIR\""'
!macroend
