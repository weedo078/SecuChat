; Custom NSIS installer script for SecuChat
; Adds Windows Defender exclusions for the install directory and user
; AppData (where Java I2P writes data/logs).

RequestExecutionLevel admin

!macro customInstall
  ; Add install directory as Defender exclusion (persistent)
  ExecWait 'powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Add-MpPreference -ExclusionPath \\"$INSTDIR\\""'

  ; Add AppData directory as Defender exclusion
  ExecWait 'powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Add-MpPreference -ExclusionPath \\"$APPDATA\\securechat\\""'
!macroend

!macro customUnInstall
  ; Remove Defender exclusion on uninstall
  ExecWait 'powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Remove-MpPreference -ExclusionPath \\"$INSTDIR\\""'

  ; Remove AppData exclusion
  ExecWait 'powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Remove-MpPreference -ExclusionPath \\"$APPDATA\\securechat\\""'
!macroend
