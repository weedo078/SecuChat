; Custom NSIS installer script for SecuChat
; Adds Windows Defender exclusion for i2pd.exe (legitimate open-source
; privacy tool, see https://i2pd.website — flagged as false positive).

RequestExecutionLevel admin

!macro customInstall
  ; Add install directory as Defender exclusion (persistent)
  ExecWait 'powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Add-MpPreference -ExclusionPath \\"$INSTDIR\\""'

  ; Add AppData directory as Defender exclusion (where i2pd writes data/logs)
  ExecWait 'powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Add-MpPreference -ExclusionPath \\"$APPDATA\\securechat\\""'

  ; Add specific exclusion for i2pd.exe process
  ExecWait 'powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Add-MpPreference -ExclusionProcess \\"i2pd.exe\\""'
!macroend

!macro customUnInstall
  ; Remove Defender exclusion on uninstall
  ExecWait 'powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Remove-MpPreference -ExclusionPath \\"$INSTDIR\\""'

  ; Remove AppData exclusion
  ExecWait 'powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Remove-MpPreference -ExclusionPath \\"$APPDATA\\securechat\\""'

  ; Remove process exclusion
  ExecWait 'powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Remove-MpPreference -ExclusionProcess \\"i2pd.exe\\""'
!macroend
