export interface TrackMeta {
  path: string;
  name: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  cover?: string;
  lyrics?: string;
  native: boolean;
  locked?: boolean;
  // 所属文件夹（主进程按当前平台路径分隔符计算），用于曲库按文件夹分组折叠
  folder?: string;
}

export interface OpenResult {
  canceled: boolean;
  paths: string[];
}

export type RevealResult = 'file' | 'folder' | 'missing';

export interface LyricsSaveResult {
  ok: boolean;
  path?: string;
  overwrote?: boolean;
  error?: string;
}

export interface UpdateInfo {
  current: string;
  latest: string;
  hasUpdate: boolean;
  url: string;
  error?: string;
}

export interface FeedbackPayload {
  type: string;
  detail: string;
  contact: string;
}

export interface FeedbackResult {
  ok: boolean;
  error?: string;
}

export interface BeatFXApi {
  openFiles(): Promise<OpenResult>;
  openFolder(): Promise<OpenResult>;
  readMeta(path: string): Promise<TrackMeta>;
  resolve(path: string): Promise<string>;
  revealFile(path: string): Promise<RevealResult>;
  scanPaths(paths: string[]): Promise<string[]>;
  getPathForFile(file: File): string;
  saveLyrics(path: string, lyrics: string): Promise<LyricsSaveResult>;
  removeLyrics(path: string): Promise<LyricsSaveResult>;
  windowAction(action: 'minimize' | 'maximize' | 'close'): void;
  getVersion(): Promise<string>;
  checkUpdate(): Promise<UpdateInfo>;
  openReleases(): Promise<void>;
  openFeedback(): Promise<void>;
  sendFeedback(payload: FeedbackPayload): Promise<FeedbackResult>;
  platform: string;
  onFilesDropped(callback: (paths: string[]) => void): void;
  onFilesOpen(callback: (paths: string[]) => void): void;
}
