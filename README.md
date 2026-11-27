# BeatFX

一个跨平台的本地音乐播放器，带专业级实时音效与 DJ 打碟机效果。支持 macOS 和 Windows。

> 作者：Joly　·　版本：1.0.0　·　许可证：MIT（代码部分）

## 功能

- **多格式播放**：MP3 / FLAC / WAV / M4A / AAC / OGG / APE / WMA / WV / DSD 等 20+ 种音频格式
- **实时音效**：低/中/高/重低音 EQ、混响、回声、变速、人声消除、限幅、HRTF 环绕、LO-FI，内置多套预设
- **DJ 打碟机**：搓碟、9 种打碟音效，支持长按操作
- **曲库管理**：按文件夹分组、拖拽导入、右键移出/定位、歌词编辑（同名 `.lrc`）
- **播放模式**：顺序 / 随机 / 单曲循环 / 列表循环，播完自动下一首
- **快捷键**：空格播放暂停，左右键短按跳转 5 秒、长按连续快进快退
- **主题**：经典深色、白天全白

## 下载安装

到 [Releases](../../releases) 页面下载对应平台的安装包：

- **macOS**：`BeatFX-1.0.0-Intel.dmg`（Intel 芯片）/ `BeatFX-1.0.0-Apple芯片.dmg`（M 芯片）
- **Windows**：`BeatFX Setup 1.0.0.exe`

macOS 最低系统版本为 11.0。M 芯片包可兼容到 macOS 27。

## 本地开发

```bash
npm install          # 安装依赖
npm run dev          # 启动开发模式
npm run build        # 类型检查 + 前端构建
```

打包：

```bash
npm run dist:win     # Windows NSIS 安装版
npm run dist:mac     # macOS 包
```

> 打包前会执行 `prepare:resources`，从 `ffmpeg-static` 复制对应平台的 ffmpeg 二进制到 `resources/`。这些二进制不纳入版本库，由 `npm install` 自动提供。

## 技术栈

Electron 37 + React 19 + TypeScript + Vite 6，音频处理使用 Web Audio API，元数据读取使用 `music-metadata`，非浏览器原生格式通过 ffmpeg 转码。

## 关于 FFmpeg

本软件捆绑 ffmpeg 二进制用于转码 APE / WMA / WV 等非浏览器原生支持的格式。ffmpeg 遵循 **LGPL / GPL** 许可证，其授权与源码获取方式请见 [FFmpeg 官方许可页面](https://ffmpeg.org/legal.html)。本仓库**不包含** ffmpeg 二进制文件，由开发者本地安装依赖后生成。

## 许可证

项目代码采用 [MIT License](LICENSE)。
