; Custom NSIS include for PilotDeck
!include LogicLib.nsh

; Fix 1: Reload icon after UAC elevation to prevent title bar icon loss.
!define MUI_CUSTOMFUNCTION_GUIINIT fixInstallerIcon

Function fixInstallerIcon
  System::Call "shell32::ExtractIcon(p 0, t '$EXEPATH', i 0) p .r0"
  StrCmp $r0 0 done
    SendMessage $HWNDPARENT 0x0080 0 $r0
    SendMessage $HWNDPARENT 0x0080 1 $r0
  done:
FunctionEnd

; Both the interactive finish page and silent --force-run updates must use
; explorer.exe to de-elevate, avoiding StdUtils.ExecShellAsUser hanging.
; The custom include precedes common.nsh. Replace its macro from customHeader,
; after common.nsh is loaded and before the install section is expanded.
!macro customHeader
  !macroundef StartApp
  ; NsisTarget expands this macro from its template directory, not resources/.
  !include "${PROJECT_DIR}\resources\installer-start-app.nsh"
  ShowInstDetails hide
!macroend

; Define this immediately before MUI_PAGE_INSTFILES, after the directory page.
!macro customPageAfterChangeDir
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW PilotDeckInstallPageShow
!macroend

!ifndef BUILD_UNINSTALLER
Function PilotDeckInstallPageShow
  SetDetailsPrint both
  ${If} $LANGUAGE == 2052
  ${OrIf} $LANGUAGE == 1028
    DetailPrint "正在准备安装，检查运行中的程序并清理旧版本……"
  ${Else}
    DetailPrint "Preparing installation: checking running applications and removing the previous version..."
  ${EndIf}
FunctionEnd
!endif

!macro customInstall
  Push $0
  Push $1
  Push $2
  FindWindow $0 "#32770" "" $HWNDPARENT
  GetDlgItem $1 $0 1004
  SendMessage $1 0x040A 0 0
  System::Call 'user32::GetWindowLong(p r1, i -16) i .r2'
  IntOp $2 $2 & -9
  System::Call 'user32::SetWindowLong(p r1, i -16, i r2)'
  SendMessage $1 0x0402 30000 0
  Pop $2
  Pop $1
  Pop $0
  SetDetailsPrint both
  ${If} $LANGUAGE == 2052
  ${OrIf} $LANGUAGE == 1028
    DetailPrint "安装完成。"
  ${Else}
    DetailPrint "Installation complete."
  ${EndIf}
!macroend

!macro PilotDeckStartApp
  Exec '"$WINDIR\explorer.exe" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
!macroend

!macro customFinishPage
  Function StartApp
    !insertmacro PilotDeckStartApp
  FunctionEnd

  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !insertmacro MUI_PAGE_FINISH
!macroend
