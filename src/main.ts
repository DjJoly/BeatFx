import { app, BrowserWindow, ipcMain, dialog, shell, Menu, type MenuItemConstructorOptions } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import * as https from 'https';
import { spawn } from 'child_process';
import type { TrackMeta, OpenResult, RevealResult, LyricsSaveResult, UpdateInfo } from './types';

// 发布仓库：建好 GitHub 仓库后只需改这里（owner/repo），发布页与检查更新都用它。
// 例如仓库地址是 https://github.com/Joly/beatfx，就写 'Joly/beatfx'。
const GITHUB_REPO = 'Joly/beatfx';
const RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases`;

// 让应用（含系统原生文件选择框）优先使用中文，而不是跟随系统的英文界面
app.commandLine.appendSwitch('lang', 'zh-CN');
process.env.LANG = 'zh_CN.UTF-8';
process.env.LANGUAGE = 'zh-CN';

// 菜单栏显示应用名（源码运行时 Electron 默认叫 Electron，打包后才是 BeatFX）
app.setName('BeatFX');

const NATIVE_EXT = new Set([
  '.mp3', '.wav', '.m4a', '.m4b', '.aac', '.ogg', '.oga', '.opus',
  '.flac', '.aiff', '.aif', '.mp4', '.webm', '.weba',
]);

const AUDIO_EXT = new Set([
  ...NATIVE_EXT, '.ape', '.wma', '.wv', '.dsf', '.dff', '.mka', '.amr',
  '.au', '.snd', '.caf', '.mid', '.midi', '.mp2', '.mp1', '.tta', '.mpc',
]);

let mainWindow: BrowserWindow | null = null;
let rendererReady = false;
const pendingOpenFiles: string[] = [];

// Single instance: a second launch forwards its file paths to the running window.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) app.quit();

function audioFilesFromArgv(argv: string[]): string[] {
  return argv.filter((arg) =>
    AUDIO_EXT.has(path.extname(arg).toLowerCase()) && fs.existsSync(arg));
}

function flushOpenFiles() {
  if (!rendererReady || !mainWindow || mainWindow.isDestroyed()) return;
  if (!pendingOpenFiles.length) return;
  const files = pendingOpenFiles.splice(0);
  mainWindow.webContents.send('files:open', files);
}

function queueOpenFiles(files: string[]) {
  if (!files.length) return;
  pendingOpenFiles.push(...files);
  flushOpenFiles();
}

// 比较语义化版本号：1.0.1 > 1.0.0 > 1.0。忽略 v 前缀与非数字后缀。
function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split(/[.\-]/).map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/i, '').split(/[.\-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

// 请求 GitHub Releases API 取最新版本号；失败也返回发布页地址，便于降级为手动打开。
async function checkForUpdate(): Promise<UpdateInfo> {
  const current = app.getVersion();
  const api = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
  try {
    const raw = await new Promise<string>((resolve, reject) => {
      const req = https.get(api, {
        headers: { 'User-Agent': 'BeatFX-Updater', Accept: 'application/vnd.github+json' },
        timeout: 8000,
      }, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
          if (body.length > 200_000) req.destroy(new Error('响应过大'));
        });
        res.on('end', () => resolve(body));
      });
      req.on('timeout', () => req.destroy(new Error('连接超时')));
      req.on('error', reject);
    });
    const data = JSON.parse(raw) as { tag_name?: string; html_url?: string };
    const latest = String(data.tag_name || '').replace(/^v/i, '');
    if (!latest) throw new Error('最新版本未标注版本号');
    return {
      current,
      latest,
      hasUpdate: compareVersions(latest, current) > 0,
      url: RELEASES_URL,
    };
  } catch (error) {
    return {
      current,
      latest: '',
      hasUpdate: false,
      url: RELEASES_URL,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function showUpdateResult(info: UpdateInfo) {
  if (info.error) {
    if (info.error.includes('404')) {
      dialog.showMessageBox(mainWindow!, {
        type: 'info',
        title: '检查更新',
        message: '仓库尚未发布任何版本',
        detail: '在 GitHub 仓库创建第一个 Release 后，这里就能检测到新版本。',
        buttons: ['好的'],
        noLink: true,
      });
      return;
    }
    const answer = await dialog.showMessageBox(mainWindow!, {
      type: 'warning',
      title: '检查更新',
      message: '暂时无法连接 GitHub 检查更新',
      detail: `${info.error}\n\n可以直接打开发布页手动查看。`,
      buttons: ['打开发布页', '取消'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (answer.response === 0) shell.openExternal(info.url).catch(() => undefined);
    return;
  }
  if (info.hasUpdate) {
    const answer = await dialog.showMessageBox(mainWindow!, {
      type: 'info',
      title: '发现新版本',
      message: `BeatFX v${info.latest} 已发布（当前 v${info.current}）`,
      detail: '即将打开发布页，请下载对应平台的安装包。',
      buttons: ['前往下载', '稍后'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (answer.response === 0) shell.openExternal(info.url).catch(() => undefined);
    return;
  }
  dialog.showMessageBox(mainWindow!, {
    type: 'info',
    title: '检查更新',
    message: `已是最新版本 v${info.current}`,
    buttons: ['好的'],
    noLink: true,
  });
}

async function showAboutDialog() {
  const answer = await dialog.showMessageBox(mainWindow!, {
    type: 'info',
    title: '关于 BeatFX',
    message: 'BeatFX 本地音乐播放器',
    detail: `版本：${app.getVersion()}\n作者：Joly\n\n支持 MP3 / FLAC / WAV / M4A / APE / OGG 等格式，内置 DJ 打碟机音效。`,
    buttons: ['检查更新', '好的'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  });
  if (answer.response === 0) await showUpdateResult(await checkForUpdate());
}

// Windows：打开系统“默认应用”设置，让用户把 BeatFX 设为音乐文件默认播放器。
// 绿色版（zip）没有安装程序，无法写注册表关联，只能引导用户手动设置。
async function setAsDefaultPlayer() {
  if (process.platform !== 'win32') {
    dialog.showMessageBox(mainWindow!, {
      type: 'info', title: '设为默认播放器',
      message: 'macOS 请在“系统设置 → 隐私与安全性 → 默认应用”中设置，或右键歌曲选择“打开方式”。',
      buttons: ['好的'], noLink: true,
    });
    return;
  }
  const packaged = app.isPackaged;
  const detail = packaged
    ? '即将打开 Windows 默认应用设置。找到 BeatFX 并设为默认，之后双击音乐文件就会用它打开。'
    : '当前为源码运行模式，文件关联只在安装版中生效。请安装 BeatFX 后再设置默认播放器。';
  const answer = await dialog.showMessageBox(mainWindow!, {
    type: 'info', title: '设为默认播放器', message: detail,
    buttons: packaged ? ['打开设置', '取消'] : ['好的'], defaultId: 0, noLink: true,
  });
  if (packaged && answer.response === 0) {
    shell.openExternal('ms-settings:defaultapps').catch(() => undefined);
  }
}

// Windows 安装版首次启动时主动引导设置默认播放器：
// Windows 10/11 禁止安装程序静默修改默认应用（UserChoice 受系统保护），
// 只能引导用户到系统设置页手动确认。用标记文件保证只提示一次。
function maybePromptDefaultAssoc() {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  const flag = path.join(app.getPath('userData'), 'default-assoc-prompted');
  if (fs.existsSync(flag)) return;
  try { fs.writeFileSync(flag, '1', 'utf8'); } catch { /* ignore */ }
  setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '设置默认播放器',
      message: '是否将 BeatFX 设为音乐文件的默认播放器？',
      detail: 'Windows 不允许程序自动修改默认应用。点击「去设置」后在列表中找到 BeatFX 并设为默认，之后双击歌曲就会用它打开。',
      buttons: ['去设置', '稍后'],
      defaultId: 0,
      noLink: true,
    }).then((r) => {
      if (r.response === 0) shell.openExternal('ms-settings:defaultapps').catch(() => undefined);
    });
  }, 2500);
}

function buildApplicationMenu() {
  const isMac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{
      label: 'BeatFX',
      submenu: [
        { label: '关于 BeatFX', click: () => showAboutDialog() },
        { type: 'separator' as const },
        { label: '隐藏 BeatFX', role: 'hide' as const },
        { label: '隐藏其他', role: 'hideOthers' as const },
        { label: '显示全部', role: 'unhide' as const },
        { type: 'separator' as const },
        { label: '退出 BeatFX', role: 'quit' as const },
      ],
    }] : []),
    {
      label: '文件',
      submenu: [
        {
          label: '打开音乐文件…', accelerator: 'CmdOrCtrl+O',
          click: async () => { const r = await openFilesDialog(); sendOpenResult(r.paths); },
        },
        {
          label: '打开音乐文件夹…', accelerator: 'CmdOrCtrl+Shift+O',
          click: async () => { const r = await openFolderDialog(); sendOpenResult(r.paths); },
        },
        { type: 'separator' },
        { label: '设为默认音乐播放器…', click: () => setAsDefaultPlayer() },
        { type: 'separator' },
        { label: '关闭窗口', role: 'close' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', role: 'undo' },
        { label: '重做', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', role: 'cut' },
        { label: '复制', role: 'copy' },
        { label: '粘贴', role: 'paste' },
        { label: '全选', role: 'selectAll' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { label: '最小化', role: 'minimize' },
        { label: '缩放', role: 'zoom' },
        ...(isMac ? [
          { type: 'separator' as const },
          { label: '置于顶层', role: 'front' as const },
        ] : []),
        { type: 'separator' },
        { label: '全屏', role: 'togglefullscreen' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        { label: '关于 BeatFX', click: () => showAboutDialog() },
        { label: '快捷键：空格播放/暂停，左右方向键快退快进', enabled: false },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  const isMac = process.platform === 'darwin';
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    frame: isMac,
    // 一律不透明：透明窗口会禁用 GPU 合成加速，冷启动与动画明显变慢。
    // 背景由渲染进程主题皮肤控制。
    transparent: false,
    backgroundColor: '#0b0b11',
    titleBarStyle: isMac ? 'hidden' : undefined,
    trafficLightPosition: isMac ? { x: 16, y: 17 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  mainWindow.webContents.on('did-finish-load', () => {
    rendererReady = true;
    flushOpenFiles();
    maybePromptDefaultAssoc();
  });
  mainWindow.on('closed', () => { mainWindow = null; rendererReady = false; });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('file://') && AUDIO_EXT.has(path.extname(url).toLowerCase())) {
      event.preventDefault();
      let dropped = url.replace(/^file:\/\//, '');
      try { dropped = decodeURIComponent(dropped); } catch { /* keep raw path */ }
      mainWindow?.webContents.send('files:dropped', [dropped]);
      return;
    }
    if (!url.startsWith('file://')) event.preventDefault();
  });

}

app.whenReady().then(() => {
  buildApplicationMenu();
  // 后台预热：应用空闲时先把 ESM 元数据模块加载并缓存，避免首次点击/双击歌曲
  // 时才加载整个模块树造成数百 ms 的卡顿。失败也不影响后续按需重试。
  setImmediate(() => { loadMusicMetadata().catch(() => undefined); });
  // Files passed on first launch (double-click in Finder / Explorer).
  // macOS delivers these via 'open-file'; Windows/Linux via argv.
  if (process.platform !== 'darwin') queueOpenFiles(audioFilesFromArgv(process.argv));
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  });
});

// macOS: double-clicking an associated file fires before/after ready.
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  queueOpenFiles(audioFilesFromArgv([filePath]));
  if (!mainWindow && app.isReady()) createWindow();
});

// Windows/Linux second instance: bring existing window forward and hand over files.
app.on('second-instance', (_event, argv) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
  queueOpenFiles(audioFilesFromArgv(argv));
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.on('window:action', (_event, action: string) => {
  if (!mainWindow) return;
  if (action === 'minimize') mainWindow.minimize();
  if (action === 'maximize') {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  }
  if (action === 'close') mainWindow.close();
});

ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('update:check', () => checkForUpdate());
ipcMain.handle('update:open', () => shell.openExternal(RELEASES_URL));

// Right-click "Open file location" from the library list.
ipcMain.handle('file:reveal', async (_event, filePath: string): Promise<RevealResult> => {
  if (!filePath) return 'missing';
  if (fs.existsSync(filePath)) {
    shell.showItemInFolder(filePath);
    return 'file';
  }
  const dir = path.dirname(filePath);
  if (fs.existsSync(dir)) {
    await shell.openPath(dir);
    return 'folder';
  }
  return 'missing';
});

function lrcPathFor(filePath: string): string {
  return path.join(path.dirname(filePath), `${path.basename(filePath, path.extname(filePath))}.lrc`);
}

ipcMain.handle('lyrics:save', async (_event, filePath: string, lyrics: string): Promise<LyricsSaveResult> => {
  const target = lrcPathFor(filePath);
  try {
    const existed = fs.existsSync(target);
    const text = lyrics.endsWith('\n') ? lyrics : `${lyrics}\n`;
    await fs.promises.writeFile(target, text, 'utf8');
    return { ok: true, path: target, overwrote: existed };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('lyrics:remove', async (_event, filePath: string): Promise<LyricsSaveResult> => {
  const target = lrcPathFor(filePath);
  try {
    if (fs.existsSync(target)) fs.unlinkSync(target);
    return { ok: true, path: target };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

function sendOpenResult(paths: string[]) {
  if (paths.length) queueOpenFiles(paths);
}

async function openFilesDialog(): Promise<OpenResult> {
  if (!mainWindow) return { canceled: true, paths: [] };
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择音乐文件',
    buttonLabel: '打开',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: '音频文件', extensions: Array.from(AUDIO_EXT).map((e) => e.slice(1)) },
      { name: '所有文件', extensions: ['*'] },
    ],
  });
  return { canceled: result.canceled, paths: result.filePaths };
}

ipcMain.handle('dialog:openFiles', openFilesDialog);

// Expand dragged/dropped paths: audio files pass through, folders are scanned.
function collectAudioFiles(paths: string[]): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const add = (file: string) => {
    const abs = path.resolve(file);
    if (seen.has(abs)) return;
    seen.add(abs);
    found.push(abs);
  };
  const walk = (dir: string, depth: number) => {
    if (depth > 6 || found.length > 2000) return;
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, depth + 1);
        else if (AUDIO_EXT.has(path.extname(entry.name).toLowerCase())) add(full);
      }
    } catch {
      // unreadable folders are skipped
    }
  };
  for (const input of paths) {
    if (!input) continue;
    try {
      const stat = fs.statSync(input);
      if (stat.isDirectory()) walk(input, 0);
      else if (AUDIO_EXT.has(path.extname(input).toLowerCase())) add(input);
    } catch {
      // missing or inaccessible paths are skipped
    }
  }
  return found.sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

ipcMain.handle('files:scan', async (_event, paths: string[]): Promise<string[]> =>
  collectAudioFiles(Array.isArray(paths) ? paths : []));

async function openFolderDialog(): Promise<OpenResult> {
  if (!mainWindow) return { canceled: true, paths: [] };
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择音乐文件夹',
    buttonLabel: '打开',
    properties: ['openDirectory'],
  });
  if (result.canceled) return { canceled: true, paths: [] };
  const files = collectAudioFiles(result.filePaths);
  return { canceled: false, paths: files };
}

ipcMain.handle('dialog:openFolder', openFolderDialog);

function ffmpegPath(): string | null {
  if (app.isPackaged) {
    const file = process.platform === 'win32'
      ? path.join(process.resourcesPath, 'resources', 'ffmpeg-win32-x64.exe')
      : path.join(process.resourcesPath, 'resources', 'ffmpeg-darwin-x64');
    return fs.existsSync(file) ? file : null;
  }
  const bundled = path.join(__dirname, '../resources', process.platform === 'win32'
    ? 'ffmpeg-win32-x64.exe' : 'ffmpeg-darwin-x64');
  if (fs.existsSync(bundled)) return bundled;
  try {
    return require('ffmpeg-static') as string;
  } catch {
    return null;
  }
}

// ---- 内置封面解析（零依赖兜底）----
// 不经过 music-metadata / ESM，直接按 ID3v2 APIC、FLAC PICTURE、MP4 covr、OGG 解析。
// 这是 Windows 打包环境的最后一道保险：即使 ESM 加载因任何原因失败，封面仍可显示。
type EmbeddedCover = { mime: string; data: Buffer };

function looksLikeImage(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  // JPEG / PNG / WebP / GIF / BMP
  return (buf[0] === 0xFF && buf[1] === 0xD8)
    || (buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG')
    || (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP')
    || (buf.toString('ascii', 0, 3) === 'GIF')
    || (buf.toString('ascii', 0, 2) === 'BM');
}

function coverMime(data: Buffer, declared: string): string {
  if (data[0] === 0xFF && data[1] === 0xD8) return 'image/jpeg';
  if (data[0] === 0x89 && data.toString('ascii', 1, 4) === 'PNG') return 'image/png';
  if (data.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (data.toString('ascii', 0, 3) === 'GIF') return 'image/gif';
  const m = (declared || '').split(';')[0].trim().toLowerCase();
  return m.startsWith('image/') ? m : 'image/jpeg';
}

function termEnd(buf: Buffer, from: number, enc: number): number {
  const step = (enc === 1 || enc === 2) ? 2 : 1;
  for (let i = from; i + step <= buf.length; i += step) {
    if (step === 1 ? buf[i] === 0 : (buf[i] === 0 && buf[i + 1] === 0)) return i;
  }
  return -1;
}

function cleanText(buf: Buffer, enc: number): string {
  // 这里只用于 MIME 类型（ASCII），去掉 UTF-16 的 0 字节即可
  let s = '';
  if (enc === 1 || enc === 2) {
    for (let i = 0; i < buf.length; i += 2) s += String.fromCharCode(buf[i]);
  } else {
    s = buf.toString('latin1');
  }
  return s.replace(/\0+$/, '').trim();
}

function parseApic(frame: Buffer): EmbeddedCover | undefined {
  if (frame.length < 8) return undefined;
  const enc = frame[0];
  const mimeEnd = termEnd(frame, 1, enc);
  if (mimeEnd < 0) return undefined;
  const mime = cleanText(frame.subarray(1, mimeEnd), enc);
  const step = (enc === 1 || enc === 2) ? 2 : 1;
  let p = mimeEnd + step + 1; // 跳过 picture type
  const descEnd = termEnd(frame, p, enc);
  if (descEnd < 0) return undefined;
  p = descEnd + step;
  const data = frame.subarray(p);
  if (!looksLikeImage(data)) return undefined;
  return { mime: coverMime(data, mime), data: Buffer.from(data) };
}

function id3Cover(buf: Buffer): EmbeddedCover | undefined {
  if (buf.length < 10 || buf.toString('latin1', 0, 3) !== 'ID3') return undefined;
  const ver = buf[3];
  const size = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
  let pos = 10;
  const end = Math.min(buf.length, pos + size);
  while (pos < end) {
    const isV22 = ver === 2;
    const headerLen = isV22 ? 6 : 10;
    if (pos + headerLen > end) break;
    const id = buf.toString('latin1', pos, pos + (isV22 ? 3 : 4));
    let frameSize: number;
    if (isV22) {
      frameSize = (buf[pos + 3] << 16) | (buf[pos + 4] << 8) | buf[pos + 5];
    } else {
      // ID3v2.3 用普通 32 位整数，v2.4 才用 synchsafe（每字节最高位为 0）
      const plain = buf.readUInt32BE(pos + 4);
      const sync = ((buf[pos + 4] & 0x7f) << 21) | ((buf[pos + 5] & 0x7f) << 14) | ((buf[pos + 6] & 0x7f) << 7) | (buf[pos + 7] & 0x7f);
      frameSize = ver === 4 ? sync : plain;
      // 部分非标准文件把 v2.3 帧大小写成 synchsafe，回退一次
      if (pos + headerLen + frameSize > end) frameSize = sync;
    }
    if (!id || frameSize <= 0 || pos + headerLen + frameSize > end) break;
    if (id === 'APIC' || id === 'PIC') {
      const found = parseApic(buf.subarray(pos + headerLen, pos + headerLen + frameSize));
      if (found) return found;
    }
    pos += headerLen + frameSize;
  }
  return undefined;
}

function parseFlacPicture(block: Buffer): EmbeddedCover | undefined {
  let p = 4; // picture type
  if (p + 4 > block.length) return undefined;
  const mimeLen = block.readUInt32BE(p); p += 4;
  if (p + mimeLen > block.length) return undefined;
  const mime = block.toString('latin1', p, p + mimeLen); p += mimeLen;
  const descLen = block.readUInt32BE(p); p += 4 + descLen + 20; // desc + width/height/depth/colors
  if (p + 4 > block.length) return undefined;
  const dataLen = block.readUInt32BE(p); p += 4;
  if (dataLen <= 0 || p + dataLen > block.length) return undefined;
  const data = block.subarray(p, p + dataLen);
  if (!looksLikeImage(data)) return undefined;
  return { mime: coverMime(data, mime), data: Buffer.from(data) };
}

function flacCover(buf: Buffer): EmbeddedCover | undefined {
  if (buf.length < 8 || buf.toString('ascii', 0, 4) !== 'fLaC') return undefined;
  let pos = 4;
  while (pos + 4 <= buf.length) {
    const last = !!(buf[pos] & 0x80);
    const type = buf[pos] & 0x7f;
    const len = (buf[pos + 1] << 16) | (buf[pos + 2] << 8) | buf[pos + 3];
    pos += 4;
    if (type === 4 && len > 0 && pos + len <= buf.length) {
      const found = parseFlacPicture(buf.subarray(pos, pos + len));
      if (found) return found;
    }
    pos += len;
    if (last || len <= 0) break;
  }
  return undefined;
}

function mp4Cover(buf: Buffer): EmbeddedCover | undefined {
  const walk = (start: number, end: number): EmbeddedCover | undefined => {
    let pos = start;
    while (pos + 8 <= end) {
      let size = buf.readUInt32BE(pos);
      const type = buf.toString('latin1', pos + 4, pos + 8);
      let header = 8;
      if (size === 1) {
        if (pos + 16 > end) break;
        size = Number(buf.readBigUInt64BE(pos + 8));
        header = 16;
      }
      if (size === 0) size = end - pos;
      if (size < header || pos + size > end) break;
      if (type === 'covr') {
        let q = pos + header;
        if (q + 8 <= pos + size && buf.toString('latin1', q + 4, q + 8) === 'data') {
          q += 16; // data atom header + version/flags + locale
          const data = buf.subarray(q, pos + size);
          if (looksLikeImage(data)) return { mime: coverMime(data, ''), data: Buffer.from(data) };
        }
      }
      if (type === 'moov' || type === 'udta' || type === 'meta' || type === 'ilst') {
        let inner = pos + header;
        if (type === 'meta') inner += 4; // version/flags
        const found = walk(inner, pos + size);
        if (found) return found;
      }
      pos += size;
    }
    return undefined;
  };
  return walk(0, buf.length);
}

function oggCover(buf: Buffer): EmbeddedCover | undefined {
  const text = buf.toString('latin1');
  const at = text.indexOf('metadata_block_picture');
  if (at < 0) return undefined;
  const valAt = text.indexOf('=', at);
  if (valAt < 0) return undefined;
  let p = valAt + 1;
  while (p < text.length && /\s/.test(text[p])) p++;
  const b64: string[] = [];
  while (p < text.length && /[A-Za-z0-9+/=]/.test(text[p])) b64.push(text[p++]);
  if (b64.length < 40) return undefined;
  try {
    const picture = Buffer.from(b64.join(''), 'base64');
    return parseFlacPicture(picture);
  } catch {
    return undefined;
  }
}

function readEmbeddedCoverFast(filePath: string): EmbeddedCover | undefined {
  try {
    const stat = fs.statSync(filePath);
    // 封面几乎总在文件前部（ID3/FLAC/MP4/OGG 均如此）；2MB 已足够，
    // 从 48MB 降到 2MB，避免冷启动时对大文件做无谓的磁盘 IO。
    const head = Buffer.alloc(Math.min(stat.size, 2 * 1024 * 1024));
    const fd = fs.openSync(filePath, 'r');
    try { fs.readSync(fd, head, 0, head.length, 0); } finally { fs.closeSync(fd); }
    return id3Cover(head) || flacCover(head) || oggCover(head) || mp4Cover(head);
  } catch {
    return undefined;
  }
}

function readExternalCover(filePath: string): string | undefined {
  try {
    const dir = path.dirname(filePath);
    const base = path.basename(filePath, path.extname(filePath));
    const names = [
      `${base}.jpg`, `${base}.jpeg`, `${base}.png`, `${base}.webp`,
      'cover.jpg', 'cover.jpeg', 'cover.png', 'cover.webp',
      'folder.jpg', 'folder.jpeg', 'folder.png',
      'album.jpg', 'album.png', 'front.jpg', 'front.png',
      'artwork.jpg', 'artwork.png', 'AlbumArt.jpg',
    ];
    const seen = new Set<string>();
    for (const name of names) {
      const lower = name.toLowerCase();
      if (seen.has(lower)) continue;
      seen.add(lower);
      const candidate = path.join(dir, name);
      if (!fs.existsSync(candidate)) continue;
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { entries = []; }
      const match = entries.find((e) => e.isFile() && e.name.toLowerCase() === lower);
      const real = match ? path.join(dir, match.name) : candidate;
      if (!fs.existsSync(real)) continue;
      const stat = fs.statSync(real);
      if (stat.size < 1024 || stat.size > 12_000_000) continue;
      const raw = fs.readFileSync(real);
      const ext = path.extname(real).toLowerCase();
      const mime = ext === '.png' ? 'image/png'
        : ext === '.webp' ? 'image/webp'
        : ext === '.jpeg' ? 'image/jpeg' : 'image/jpeg';
      return `data:${mime};base64,${raw.toString('base64')}`;
    }
  } catch {
    // Cover is optional.
  }
  return undefined;
}

function readExternalLyrics(filePath: string, title: string, artist: string): string | undefined {
  try {
    const dir = path.dirname(filePath);
    const base = path.basename(filePath, path.extname(filePath));
    const names = [
      `${base}.lrc`,
      `${title}.lrc`,
      `${artist} - ${title}.lrc`,
      `${artist}-${title}.lrc`,
      `${base}.txt`,
    ];
    const seen = new Set<string>();
    for (const name of names) {
      if (!name || seen.has(name)) continue;
      seen.add(name);
      const candidate = path.join(dir, name);
      if (!fs.existsSync(candidate)) continue;
      const raw = fs.readFileSync(candidate);
      let text = raw.toString('utf8');
      if (text.includes('\uFFFD')) {
        try { text = new TextDecoder('gbk').decode(raw); } catch { /* keep utf8 result */ }
      }
      if (text.trim()) return text;
    }
  } catch {
    // Lyrics are optional.
  }
  return undefined;
}

function extractEmbeddedLyrics(common: any): string | undefined {
  const value = common?.lyrics;
  if (!value) return undefined;
  if (typeof value === 'string') return value.trim() || undefined;
  if (Array.isArray(value)) {
    const parts = value
      .map((tag: any) => (typeof tag === 'string' ? tag : tag?.text))
      .filter((text: any) => typeof text === 'string' && text.trim());
    if (parts.length) return parts.join('\n');
  }
  return undefined;
}

// music-metadata 11 只提供 ESM。关键点：主进程以 CommonJS 编译，TypeScript 会把
// `await import(x)` 降级成 `require(x)`，而 require() 不接受 file:// URL —— 这正是
// Windows 打包后封面/歌词一直读不到的根因。用 new Function 保留原生动态 import。
// 同时显式定位到 app.asar.unpacked 的绝对 file:// 路径，避免裸包名被按 cwd 解析。
const nativeImport = new Function('specifier', 'return import(specifier)') as (s: string) => Promise<any>;
let metadataModulePromise: Promise<any> | null = null;
function loadMusicMetadata(): Promise<any> {
  if (!metadataModulePromise) {
    metadataModulePromise = (async () => {
      const { pathToFileURL } = require('url') as typeof import('url');
      const candidates: string[] = [];
      // 打包环境优先：app.asar.unpacked 是真实文件系统路径，ESM import 最可靠
      try {
        const appPath = app.getAppPath();
        if (appPath.includes('app.asar')) {
          candidates.push(path.join(appPath.replace(/app\.asar([\\/]|$)/, 'app.asar.unpacked$1'), 'node_modules', 'music-metadata'));
        }
        candidates.push(path.join(appPath, 'node_modules', 'music-metadata'));
      } catch { /* app not ready yet */ }
      // 开发环境：src 编译到 dist-electron，node_modules 在上一级
      candidates.push(path.join(__dirname, '..', 'node_modules', 'music-metadata'));
      candidates.push(path.join(__dirname, 'node_modules', 'music-metadata'));

      const errors: string[] = [];
      for (const base of candidates) {
        try {
          const pkgPath = path.join(base, 'package.json');
          if (!fs.existsSync(pkgPath)) continue;
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
          let entryRel: any = pkg?.exports?.node?.import ?? pkg?.exports?.import ?? pkg?.main ?? 'lib/index.js';
          if (typeof entryRel !== 'string') entryRel = 'lib/index.js';
          const entry = path.join(base, entryRel);
          if (!fs.existsSync(entry)) continue;
          const mod = await nativeImport(pathToFileURL(entry).href);
          console.log('[BeatFX] 元数据模块已加载:', entry);
          return mod;
        } catch (error) {
          errors.push(`${base}: ${(error as Error)?.message || error}`);
        }
      }
      console.warn('[BeatFX] ESM 元数据模块加载失败，将使用内置封面解析:', errors.join(' | ').slice(0, 500));
      throw new Error('无法加载 music-metadata');
    })().catch((error) => {
      metadataModulePromise = null; // 允许下次重试
      throw error;
    });
  }
  return metadataModulePromise;
}

function cacheDir(): string {
  const dir = path.join(app.getPath('userData'), 'transcode');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cacheKey(filePath: string): string {
  let stamp = filePath;
  try {
    const stat = fs.statSync(filePath);
    stamp += `${stat.size}-${stat.mtimeMs}`;
  } catch {
    // fall back to path only
  }
  return crypto.createHash('sha256').update(stamp).digest('hex').slice(0, 24);
}

function transcode(input: string, output: string): Promise<void> {
  const binary = ffmpegPath();
  if (!binary) return Promise.reject(new Error('未找到 ffmpeg，无法转码该格式'));

  return new Promise((resolve, reject) => {
    const child = spawn(binary, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', input,
      '-vn', '-map', '0:a:0',
      '-acodec', 'libmp3lame', '-b:a', '192k', '-ar', '44100', '-ac', '2',
      output,
    ]);
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0 && fs.existsSync(output) && fs.statSync(output).size > 0) resolve();
      else reject(new Error(`ffmpeg 转码失败 (${code}): ${stderr.slice(-400)}`));
    });
  });
}

ipcMain.handle('track:metadata', async (_event, filePath: string): Promise<TrackMeta> => {
  const ext = path.extname(filePath).toLowerCase();
  const base = path.basename(filePath, ext);
  let title = base;
  let artist = '';
  let album = '';
  let duration = 0;
  let cover: string | undefined;
  let lyrics: string | undefined;
  let embeddedLyrics: string | undefined;

  try {
    const mod = await loadMusicMetadata();
    const metadata = await mod.parseFile(filePath, { duration: true });
    title = metadata.common.title?.trim() || base;
    artist = metadata.common.artist?.trim() || '';
    album = metadata.common.album?.trim() || '';
    duration = metadata.format.duration || 0;
    const pictures = metadata.common.picture || [];
    for (const picture of pictures) {
      const len = picture?.data?.byteLength ?? picture?.data?.length ?? 0;
      if (!len || len > 8_000_000) continue;
      // picture.data is a Uint8Array in music-metadata 11.x, not a Buffer.
      // Uint8Array#toString() would produce "255,216,..." instead of base64.
      const bytes = Buffer.isBuffer(picture.data)
        ? picture.data
        : Buffer.from(picture.data.buffer ?? picture.data, picture.data.byteOffset ?? 0, picture.data.byteLength ?? picture.data.length);
      const fmt = (picture.format || 'image/jpeg').toLowerCase();
      const mime = fmt.includes('png') ? 'image/png'
        : fmt.includes('webp') ? 'image/webp'
        : fmt.includes('gif') ? 'image/gif' : 'image/jpeg';
      cover = `data:${mime};base64,${bytes.toString('base64')}`;
      break;
    }
    embeddedLyrics = extractEmbeddedLyrics(metadata.common);
  } catch (error) {
    console.warn('[BeatFX] 元数据读取失败:', (error as Error)?.message || error);
  }

  // 兜底 1：内置零依赖解析（Windows 上 ESM 失败时依然能拿到封面）
  if (!cover) {
    const fast = readEmbeddedCoverFast(filePath);
    if (fast) {
      cover = `data:${fast.mime};base64,${fast.data.toString('base64')}`;
      console.log('[BeatFX] 内置解析到封面:', path.basename(filePath), fast.mime, fast.data.length);
    }
  }
  // 兜底 2：同目录同名图片
  if (!cover) cover = readExternalCover(filePath);

  // A sidecar .lrc file is preferred (it usually carries accurate timestamps).
  lyrics = readExternalLyrics(filePath, title, artist) ?? embeddedLyrics;

  return {
    path: filePath,
    name: path.basename(filePath),
    title,
    artist,
    album,
    duration,
    cover,
    lyrics,
    native: NATIVE_EXT.has(ext),
    folder: path.dirname(filePath),
  };
});

ipcMain.handle('track:resolve', async (_event, filePath: string): Promise<string> => {
  const ext = path.extname(filePath).toLowerCase();
  if (NATIVE_EXT.has(ext)) return filePath;

  const output = path.join(cacheDir(), `${cacheKey(filePath)}.mp3`);
  if (fs.existsSync(output) && fs.statSync(output).size > 0) return output;
  await transcode(filePath, output);
  return output;
});
