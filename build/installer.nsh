; 安装/卸载前先让正在运行的程序正常退出（这样它会恢复任务栏和桌面图标），
; 然后再执行 electron-builder 默认的检查（必要时强制结束）。
!include "getProcessInfo.nsh"
Var pid

!macro customCheckAppRunning
  IfFileExists "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 +3
    ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --quit'
    Sleep 2000
  !insertmacro IS_POWERSHELL_AVAILABLE
  !insertmacro _CHECK_APP_RUNNING
!macroend

!macro customInstall
  CreateShortCut "$SMPROGRAMS\${PRODUCT_NAME}\退出 ${PRODUCT_NAME}.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "--quit" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
  CreateShortCut "$SMPROGRAMS\${PRODUCT_NAME}\恢复任务栏和桌面图标.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "--restore" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
!macroend

!macro customUnInstall
  ; 程序可能是被强制结束的：确保任务栏、桌面图标恢复，并移除开机启动
  ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --restore'
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "MinecraftDesktop"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "MinecraftDesktop"
  Delete "$SMPROGRAMS\${PRODUCT_NAME}\退出 ${PRODUCT_NAME}.lnk"
  Delete "$SMPROGRAMS\${PRODUCT_NAME}\恢复任务栏和桌面图标.lnk"
!macroend
