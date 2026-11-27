; BeatFX 自定义安装脚本
; 目的：让 BeatFX 出现在 Windows「右键 → 打开方式 → 建议的应用」列表中，
; 并且列表里显示简短一致的「BeatFX」，而不是长名字。
; electron-builder 自带的 APP_ASSOCIATE 只设置默认程序（Software\Classes\.ext 默认值），
; 而且用 fileAssociations.name 当 ProgID、description 当友好名、菜单文本固定为
; "Open with <productName>"。这里在 customInstall 阶段（晚于 APP_ASSOCIATE）统一覆盖成短名。

!ifndef SHCNE_ASSOCCHANGED
  !define SHCNE_ASSOCCHANGED 0x08000000
!endif
!ifndef SHCNF_FLUSH
  !define SHCNF_FLUSH 0x1000
!endif

!define BFX_PROGID "BeatFX.Audio"

!macro BFX_OPENWITH EXT
  ; 扩展名指向我们的 ProgID（覆盖 APP_ASSOCIATE 写的），保持单一关联
  WriteRegStr SHELL_CONTEXT "Software\Classes\.${EXT}" "" "${BFX_PROGID}"
  WriteRegStr SHELL_CONTEXT "Software\Classes\.${EXT}\OpenWithProgids" "${BFX_PROGID}" ""
  WriteRegStr SHELL_CONTEXT "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.${EXT}\OpenWithProgids" "${BFX_PROGID}" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\BeatFX.exe\SupportedTypes" ".${EXT}" ""
!macroend

!macro customInstall
  ; ---- 简短一致的显示名 ----
  ; ProgID 友好名（右键「打开方式」列表里显示的就是它）
  WriteRegStr SHELL_CONTEXT "Software\Classes\${BFX_PROGID}" "" "BeatFX"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${BFX_PROGID}\shell\open" "" "使用 BeatFX 打开"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${BFX_PROGID}\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  WriteRegStr SHELL_CONTEXT "Software\Classes\${BFX_PROGID}\DefaultIcon" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}",0'
  ; 应用程序条目名（「建议的应用」/默认应用设置页显示）
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\BeatFX.exe" "" "BeatFX"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\BeatFX.exe\shell\open" "" "使用 BeatFX 打开"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\BeatFX.exe\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'

  !insertmacro BFX_OPENWITH "mp3"
  !insertmacro BFX_OPENWITH "wav"
  !insertmacro BFX_OPENWITH "m4a"
  !insertmacro BFX_OPENWITH "m4b"
  !insertmacro BFX_OPENWITH "aac"
  !insertmacro BFX_OPENWITH "ogg"
  !insertmacro BFX_OPENWITH "oga"
  !insertmacro BFX_OPENWITH "opus"
  !insertmacro BFX_OPENWITH "flac"
  !insertmacro BFX_OPENWITH "aiff"
  !insertmacro BFX_OPENWITH "aif"
  !insertmacro BFX_OPENWITH "ape"
  !insertmacro BFX_OPENWITH "wma"
  !insertmacro BFX_OPENWITH "wv"
  !insertmacro BFX_OPENWITH "dsf"
  !insertmacro BFX_OPENWITH "dff"
  !insertmacro BFX_OPENWITH "mka"
  !insertmacro BFX_OPENWITH "mp2"
  !insertmacro BFX_OPENWITH "mp1"
  !insertmacro BFX_OPENWITH "tta"
  !insertmacro BFX_OPENWITH "mpc"

  ; 通知 Shell 刷新文件关联缓存
  !ifdef SHCNE_ASSOCCHANGED
    System::Call "shell32::SHChangeNotify(i,i,i,i) (${SHCNE_ASSOCCHANGED}, ${SHCNF_FLUSH}, 0, 0)"
  !endif
!macroend

!macro BFX_UNOPENWITH EXT
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.${EXT}\OpenWithProgids" "${BFX_PROGID}"
  DeleteRegValue SHELL_CONTEXT "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.${EXT}\OpenWithProgids" "${BFX_PROGID}"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\Applications\BeatFX.exe\SupportedTypes" ".${EXT}"
!macroend

!macro customUnInstall
  !insertmacro BFX_UNOPENWITH "mp3"
  !insertmacro BFX_UNOPENWITH "wav"
  !insertmacro BFX_UNOPENWITH "m4a"
  !insertmacro BFX_UNOPENWITH "m4b"
  !insertmacro BFX_UNOPENWITH "aac"
  !insertmacro BFX_UNOPENWITH "ogg"
  !insertmacro BFX_UNOPENWITH "oga"
  !insertmacro BFX_UNOPENWITH "opus"
  !insertmacro BFX_UNOPENWITH "flac"
  !insertmacro BFX_UNOPENWITH "aiff"
  !insertmacro BFX_UNOPENWITH "aif"
  !insertmacro BFX_UNOPENWITH "ape"
  !insertmacro BFX_UNOPENWITH "wma"
  !insertmacro BFX_UNOPENWITH "wv"
  !insertmacro BFX_UNOPENWITH "dsf"
  !insertmacro BFX_UNOPENWITH "dff"
  !insertmacro BFX_UNOPENWITH "mka"
  !insertmacro BFX_UNOPENWITH "mp2"
  !insertmacro BFX_UNOPENWITH "mp1"
  !insertmacro BFX_UNOPENWITH "tta"
  !insertmacro BFX_UNOPENWITH "mpc"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\${BFX_PROGID}"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\Applications\BeatFX.exe"
  !ifdef SHCNE_ASSOCCHANGED
    System::Call "shell32::SHChangeNotify(i,i,i,i) (${SHCNE_ASSOCCHANGED}, ${SHCNF_FLUSH}, 0, 0)"
  !endif
!macroend
