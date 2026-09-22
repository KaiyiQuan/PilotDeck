; Included immediately after the upstream installer.nsh defines this macro.
; The rest of electron-builder's install/update/uninstall protocol is unchanged.
!macroundef extractUsing7za
!macro extractUsing7za ARCHIVE
  File /oname=$PLUGINSDIR\install-payload.exe "${PROJECT_DIR}\resources\.installer-tools\install-payload.exe"
  File /oname=$PLUGINSDIR\7za.exe "${PROJECT_DIR}\resources\.installer-tools\7za.exe"
  File /oname=$PLUGINSDIR\7zip-LICENSE.txt "${PROJECT_DIR}\resources\.installer-tools\LICENSE.txt"
  File /oname=$PLUGINSDIR\7zip-COPYING.txt "${PROJECT_DIR}\resources\.installer-tools\COPYING"
  StrCpy $R8 "en"
  ${If} $LANGUAGE == 2052
  ${OrIf} $LANGUAGE == 1028
    StrCpy $R8 "zh"
  ${EndIf}
  pilotdeck_extract_retry:
    SetDetailsPrint both
    nsExec::ExecToLog '"$PLUGINSDIR\install-payload.exe" "$PLUGINSDIR\7za.exe" "${ARCHIVE}" "$INSTDIR" "$HWNDPARENT" "$R8"'
    Pop $R9
    ${If} $R9 != 0
      SetDetailsView show
      StrCpy $R7 "Installation failed. Close applications using this folder, check free disk space, and see the details below before retrying."
      ${If} $R8 == "zh"
        StrCpy $R7 "安装未完成。请关闭占用安装目录的程序、检查磁盘空间，并查看下方详情后重试。"
      ${EndIf}
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$R7" /SD IDCANCEL IDRETRY pilotdeck_extract_retry
      SetErrorLevel 1
      Quit
    ${EndIf}
!macroend
