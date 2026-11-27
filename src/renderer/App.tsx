import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Music2, FolderOpen, FileAudio2, Search, Play, Pause, SkipBack, SkipForward,
  Shuffle, Repeat, Repeat1, Volume2, SlidersHorizontal, Minus, Square, X,
  RotateCcw, Disc3, Waves, Zap, Moon, Radio, LoaderCircle, ListMusic, Trash2, ListX, FileText,
  AudioLines, Activity, Sparkles, Gauge, AudioWaveform, Wind, Repeat2, RadioTower, VolumeX, Hand,
  Palette, ChevronDown, ChevronRight, Check, Sun,
} from 'lucide-react';
import type { TrackMeta } from '../types';
import { AudioEngine } from './audio/AudioEngine';
import { DEFAULT_EFFECTS, PRESETS, type EffectsState } from './presets';

const fmt = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

const hue = (text: string) => {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 360;
  return h;
};

// 取歌曲所属文件夹；老曲库条目没有 folder 字段时从路径推算（兼容 / 与 \ 分隔符）。
const folderOf = (track: TrackMeta): string => {
  if (track.folder) return track.folder;
  const i = Math.max(track.path.lastIndexOf('/'), track.path.lastIndexOf('\\'));
  return i > 0 ? track.path.slice(0, i) : track.path;
};
const folderLabel = (folder: string): string => folder.split(/[\\/]/).filter(Boolean).pop() || folder;

const EMPTY_SPECTRUM = new Uint8Array(1024);

// 环绕开启时不叠加回声，否则旋转声像会和回声尾音混在一起像两首歌在放。
const noEchoWithSurround = (fx: EffectsState): EffectsState =>
  (fx.surround ?? 0) > 0 ? { ...fx, echo: 0 } : fx;

type Theme = 'dark' | 'light';
const THEMES: { id: Theme; label: string; icon: typeof Moon }[] = [
  { id: 'dark', label: '经典深色', icon: Moon },
  { id: 'light', label: '白天全白', icon: Sun },
];
const readTheme = (): Theme => {
  try {
    const saved = localStorage.getItem('beatfx.theme');
    // 旧版保存过已移除的 glass 皮肤，回退到默认深色。
    if (saved === 'light') return saved;
  } catch { /* storage disabled */ }
  return 'dark';
};

// 浏览器可直接解码的格式——用于冷启动时先构造最小元数据立即出声，无需等 readMeta。
const NATIVE_EXT = new Set(['mp3', 'wav', 'm4a', 'm4b', 'aac', 'ogg', 'oga', 'opus',
  'flac', 'aiff', 'aif', 'mp4', 'webm', 'weba']);

interface LyricLine { time: number; text: string }

function parseLyrics(raw?: string): LyricLine[] {
  if (!raw || !raw.trim()) return [];
  const tag = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
  const lines: LyricLine[] = [];
  for (const row of raw.split(/\r?\n/)) {
    const matches = [...row.matchAll(tag)];
    const text = row.replace(tag, '').trim();
    if (!matches.length) {
      if (text && !/^\[(ti|ar|al|by|offset|length|re|ve):/i.test(text)) {
        lines.push({ time: -1, text });
      }
      continue;
    }
    for (const m of matches) {
      const fraction = m[3] ? Number(m[3]) / 10 ** m[3].length : 0;
      const seconds = Number(m[1]) * 60 + Number(m[2]) + fraction;
      lines.push({ time: seconds, text });
    }
  }
  const timed = lines.filter((line) => line.time >= 0).sort((a, b) => a.time - b.time);
  const plain = lines.filter((line) => line.time < 0);
  if (timed.length) {
    return timed.filter((line, i) => i === 0 || line.time !== timed[i - 1].time).concat(plain);
  }
  return plain;
}

function WaveMark({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12h2.5l2-5 3.5 10 3-8 2 3H22" />
    </svg>
  );
}

function Visualizer({ engine, playing }: { engine: AudioEngine; playing: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // 未播放时不触碰音频引擎，避免启动时就构建音频图（混响脉冲等重计算）
      const data = playing ? engine.frequencyData() : EMPTY_SPECTRUM;
      const bars = 64;
      const gap = 3;
      const barW = Math.max(2, (w - gap * (bars - 1)) / bars);
      const gradient = ctx.createLinearGradient(0, h, 0, 0);
      gradient.addColorStop(0, '#25f4ee');
      gradient.addColorStop(0.55, '#7b5cff');
      gradient.addColorStop(1, '#fe2c55');
      ctx.fillStyle = gradient;

      for (let i = 0; i < bars; i++) {
        const idx = Math.floor(Math.pow(i / bars, 1.6) * Math.min(data.length, 700));
        const raw = playing ? data[idx] / 255 : 0.04 + 0.03 * Math.sin(i * 0.5 + Date.now() / 600);
        const barH = Math.max(3, Math.pow(raw, 1.3) * (h - 8));
        const x = i * (barW + gap);
        ctx.globalAlpha = 0.35 + raw * 0.65;
        ctx.beginPath();
        ctx.roundRect(x, h - barH, barW, barH, Math.min(3, barW / 2));
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [engine, playing]);

  return <canvas ref={canvasRef} className="visualizer" />;
}

function Slider({
  label, value, min, max, step, onChange, format,
}: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; format?: (v: number) => string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <label className="slider-row">
      <span className="slider-label">{label}</span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        style={{ '--pct': `${pct}%` } as React.CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="slider-value">{format ? format(value) : value}</span>
    </label>
  );
}

export default function App() {
  const engineRef = useRef<AudioEngine | null>(null);
  if (!engineRef.current) engineRef.current = new AudioEngine();
  const engine = engineRef.current;

  const [tracks, setTracks] = useState<TrackMeta[]>([]);
  const [current, setCurrent] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.85);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<'off' | 'all' | 'one'>('off');
  const [query, setQuery] = useState('');
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('beatfx.folders') || '[]') as string[];
      return new Set(Array.isArray(saved) ? saved : []);
    } catch { return new Set(); }
  });
  const [effects, setEffects] = useState<EffectsState>(DEFAULT_EFFECTS);
  const [preset, setPreset] = useState('原声');
  const [status, setStatus] = useState('就绪 · 拖入音频文件即可播放');
  const [version, setVersion] = useState('');
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [showLyrics, setShowLyrics] = useState(false);
  const [pendingPlayPath, setPendingPlayPath] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ path: string; x: number; y: number; confirmClear?: boolean } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [lyricEditor, setLyricEditor] = useState<{ path: string; title: string } | null>(null);
  const [lyricDraft, setLyricDraft] = useState('');
  const [writeLrcFile, setWriteLrcFile] = useState(true);
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [themeMenu, setThemeMenu] = useState(false);

  // 外观皮肤：写到根元素，弹窗/右键菜单等 portal 之外的元素也能继承主题变量
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('beatfx.theme', theme); } catch { /* storage disabled */ }
  }, [theme]);
  useEffect(() => {
    if (!themeMenu) return;
    const close = () => setThemeMenu(false);
    const onDown = (event: MouseEvent) => {
      if (!(event.target as HTMLElement | null)?.closest('.theme-switch')) close();
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', close);
    };
  }, [themeMenu]);

  // DJ 打碟机效果：momentary 为按住生效，toggle 为点击切换
  type MomentaryFx = 'scratch' | 'filter' | 'brake' | 'siren' | 'repeat';
  type ToggleFx = 'noise' | 'flanger' | 'phaser' | 'crusher';
  const [djMomentary, setDjMomentary] = useState<Record<MomentaryFx, boolean>>({
    scratch: false, filter: false, brake: false, siren: false, repeat: false,
  });
  const [djToggle, setDjToggle] = useState<Record<ToggleFx, boolean>>({
    noise: false, flanger: false, phaser: false, crusher: false,
  });
  // 触摸板轻放手指不会产生 pointerdown；用悬停停留模拟“长触摸”，与按住状态分开跟踪
  const hoverTimers = useRef<Partial<Record<MomentaryFx, number>>>({});
  const hoverActive = useRef<Record<MomentaryFx, boolean>>({
    scratch: false, filter: false, brake: false, siren: false, repeat: false,
  });
  const pointerHeld = useRef<Record<MomentaryFx, boolean>>({
    scratch: false, filter: false, brake: false, siren: false, repeat: false,
  });
  const dragDepth = useRef(0);
  const lyricBoxRef = useRef<HTMLDivElement>(null);
  const hydrated = useRef(false);
  const currentRef = useRef(current);
  currentRef.current = current;
  const lyricEditorRef = useRef(lyricEditor);
  lyricEditorRef.current = lyricEditor;
  const contextMenuRef = useRef(contextMenu);
  contextMenuRef.current = contextMenu;

  const applyEffects = useCallback((input: EffectsState) => {
    const fx = noEchoWithSurround(input);
    engine.setBand('low', fx.low);
    engine.setBand('mid', fx.mid);
    engine.setBand('high', fx.high);
    engine.setBass(fx.bass);
    engine.setReverb(fx.reverb);
    engine.setEcho(fx.echo);
    engine.setSurround(fx.surround ?? 0);
    engine.setVocalRemoval(fx.vocal);
    engine.setLimiter(fx.limiter);
    engine.setSpeed(fx.speed);
  }, [engine]);

  useEffect(() => { applyEffects(effects); }, [effects, applyEffects]);
  useEffect(() => { engine.setVolume(volume); }, [volume, engine]);

  // DJ 效果：按住型用 ref 跟踪，避免 pointer 事件闭包问题
  const setMomentary = useCallback((key: MomentaryFx, on: boolean) => {
    setDjMomentary((prev) => ({ ...prev, [key]: on }));
    switch (key) {
      case 'scratch': engine.setScratch(on); break;
      case 'filter': engine.setFilterSweep(on); break;
      case 'brake': engine.setVinylBrake(on); break;
      case 'siren': engine.setSiren(on); break;
      case 'repeat': engine.setBeatRepeat(on); break;
    }
  }, [engine]);
  const clearHoverTimer = useCallback((key: MomentaryFx) => {
    const timer = hoverTimers.current[key];
    if (timer) {
      window.clearTimeout(timer);
      delete hoverTimers.current[key];
    }
  }, []);

  const releaseAllMomentary = useCallback(() => {
    (Object.keys(djMomentary) as MomentaryFx[]).forEach((k) => {
      clearHoverTimer(k);
      hoverActive.current[k] = false;
      pointerHeld.current[k] = false;
      if (djMomentary[k]) setMomentary(k, false);
    });
  }, [djMomentary, setMomentary, clearHoverTimer]);
  useEffect(() => {
    window.addEventListener('blur', releaseAllMomentary);
    return () => window.removeEventListener('blur', releaseAllMomentary);
  }, [releaseAllMomentary]);
  useEffect(() => () => {
    (Object.keys(hoverTimers.current) as MomentaryFx[]).forEach(clearHoverTimer);
  }, [clearHoverTimer]);

  /** 按住立即生效；光标/触摸板指针停留 0.42 秒也会生效，移开即停。 */
  const momentaryProps = (key: MomentaryFx) => ({
    onPointerEnter: () => {
      if (pointerHeld.current[key] || hoverActive.current[key]) return;
      clearHoverTimer(key);
      hoverTimers.current[key] = window.setTimeout(() => {
        delete hoverTimers.current[key];
        hoverActive.current[key] = true;
        setMomentary(key, true);
      }, 420);
    },
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      clearHoverTimer(key);
      pointerHeld.current[key] = true;
      setMomentary(key, true);
    },
    onPointerUp: () => {
      pointerHeld.current[key] = false;
      if (!hoverActive.current[key]) setMomentary(key, false);
    },
    onPointerLeave: () => {
      clearHoverTimer(key);
      pointerHeld.current[key] = false;
      if (hoverActive.current[key]) {
        hoverActive.current[key] = false;
        setMomentary(key, false);
      } else if (djMomentary[key]) {
        setMomentary(key, false);
      }
    },
    onPointerCancel: () => {
      clearHoverTimer(key);
      pointerHeld.current[key] = false;
      hoverActive.current[key] = false;
      setMomentary(key, false);
    },
  });

  const toggleDj = useCallback((key: ToggleFx) => {
    setDjToggle((prev) => {
      const on = !prev[key];
      switch (key) {
        case 'noise': engine.setNoise(on); break;
        case 'flanger': engine.setFlanger(on); break;
        case 'phaser': engine.setPhaser(on); break;
        case 'crusher': engine.setCrusher(on); break;
      }
      return { ...prev, [key]: on };
    });
  }, [engine]);
  const resetDj = useCallback(() => {
    releaseAllMomentary();
    (Object.keys(djToggle) as ToggleFx[]).forEach((k) => {
      if (djToggle[k]) toggleDj(k);
    });
  }, [djToggle, toggleDj, releaseAllMomentary]);
  useEffect(() => {
    if (!hydrated.current) return;
    localStorage.setItem('beatfx.library', JSON.stringify(tracks));
  }, [tracks]);
  useEffect(() => {
    if (!hydrated.current) return;
    localStorage.setItem('beatfx.effects', JSON.stringify(effects));
  }, [effects]);
  useEffect(() => {
    if (!hydrated.current) return;
    localStorage.setItem('beatfx.folders', JSON.stringify([...collapsedFolders]));
  }, [collapsedFolders]);

  // 鼠标悬停即提前 resolve：原生格式只是 IPC 往返，非原生格式会提前把整首歌
  // 转码进缓存，点击时直接命中，消除最大的一段等待。
  const prefetched = useRef(new Set<string>());
  const prefetchTrack = useCallback((track: TrackMeta) => {
    if (prefetched.current.has(track.path)) return;
    prefetched.current.add(track.path);
    window.beatfx.resolve(track.path).catch(() => undefined);
  }, []);

  const playIndex = useCallback(async (index: number) => {
    const meta = tracks[index];
    if (!meta) return;
    // UI 立即切换：封面、标题、列表高亮先更新，不再等音频缓冲。
    setCurrent(index);
    setPlaying(true);
    setTime(0);
    setDuration(meta.duration || 0);
    const needTranscode = !meta.native;
    // 只有需要 ffmpeg 转码时才转圈；原生格式直接静默缓冲。
    setLoading(needTranscode);
    setStatus(needTranscode ? `正在转码 ${meta.title} …` : `正在播放 · ${meta.title}`);
    try {
      const src = await window.beatfx.resolve(meta.path);
      await engine.load(src);
      applyEffects(effects);
      engine.setVolume(volume);
      // 不再 await play()：audio.play() 的 Promise 要等缓冲就绪才 resolve，
      // 让 UI 卡在这里才是"转圈等一会"的根因。缓冲在后台进行，play 事件会同步状态。
      engine.play().catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        setStatus(`播放失败：${message}`);
        setPlaying(false);
      });
      setLoading(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`播放失败：${message}`);
      setPlaying(false);
      setLoading(false);
    }
  }, [tracks, engine, applyEffects, effects, volume]);

  const next = useCallback((auto = false) => {
    if (tracks.length === 0) return;
    if (repeat === 'one' && auto && current !== null) {
      engine.seek(0);
      engine.play().catch(() => undefined);
      return;
    }
    let target = current === null ? 0 : current + 1;
    if (shuffle && tracks.length > 1) {
      do { target = Math.floor(Math.random() * tracks.length); } while (target === current);
    }
    if (target >= tracks.length) {
      if (repeat === 'off' && auto) {
        engine.pause();
        setPlaying(false);
        return;
      }
      target = 0;
    }
    playIndex(target);
  }, [tracks, repeat, current, shuffle, engine, playIndex]);

  // ended 事件在挂载时注册一次，需用 ref 拿到最新的 next，避免闭包捕获空曲库
  const nextRef = useRef(next);
  nextRef.current = next;

  const prev = useCallback(() => {
    if (current === null) return;
    if (engine.audio.currentTime > 3) {
      engine.seek(0);
      setTime(0);
      return;
    }
    playIndex((current - 1 + tracks.length) % tracks.length);
  }, [current, engine, playIndex, tracks.length]);

  // 检查更新：主进程查 GitHub Releases 比对版本，有新版本或网络失败时打开发布页
  async function handleCheckUpdate() {
    if (checkingUpdate) return;
    setCheckingUpdate(true);
    setStatus('正在检查更新…');
    try {
      const info = await window.beatfx.checkUpdate();
      if (info.error) {
        if (info.error.includes('404')) {
          setStatus('仓库尚未发布版本，请先创建 GitHub Release');
        } else {
          setStatus('检查失败，已打开发布页');
          await window.beatfx.openReleases();
        }
      } else if (info.hasUpdate) {
        setStatus(`发现新版本 v${info.latest}，已打开发布页`);
        await window.beatfx.openReleases();
      } else {
        setStatus(`已是最新版本 v${info.current}`);
      }
    } catch {
      setStatus('检查更新失败');
    } finally {
      setCheckingUpdate(false);
    }
  }

  // 从系统双击文件打开：曲目加入曲库后自动播放对应那首
  useEffect(() => {
    if (!pendingPlayPath) return;
    const index = tracks.findIndex((t) => t.path === pendingPlayPath);
    if (index < 0) return;
    setPendingPlayPath(null);
    playIndex(index);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPlayPath, tracks]);

  useEffect(() => {
    const offs = [
      engine.on('timeupdate', () => setTime(engine.audio.currentTime)),
      engine.on('loadedmetadata', () => {
        if (Number.isFinite(engine.audio.duration)) setDuration(engine.audio.duration);
      }),
      engine.on('play', () => setPlaying(true)),
      engine.on('pause', () => setPlaying(false)),
      engine.on('ended', () => nextRef.current(true)),
      engine.on('error', () => setStatus('音频解码失败，请尝试其他格式或文件')),
    ];
    window.beatfx.getVersion().then(setVersion).catch(() => undefined);
    // 空闲时预热音频图（节点 + 卷积脉冲生成），首次点歌不再现场构建。
    const warmId = window.setTimeout(() => engine.warmup(), 800);
    window.beatfx.onFilesDropped((paths) => { addPaths(paths); });
    window.beatfx.onFilesOpen((paths) => { fastOpenAndPlay(paths); });

    try {
      const savedTracks = JSON.parse(localStorage.getItem('beatfx.library') || '[]') as TrackMeta[];
      const savedEffects = JSON.parse(localStorage.getItem('beatfx.effects') || 'null') as EffectsState | null;
      if (Array.isArray(savedTracks) && savedTracks.length) {
        setTracks(savedTracks);
        // Old builds saved a broken cover string (comma-separated bytes) or none at all.
        // Re-read those tracks in the background so covers and lyrics appear after an upgrade.
        const stale = savedTracks.filter((t) => !t.cover || /^data:[^;]+;base64,\d+[,.]/.test(t.cover));
        if (stale.length) {
          Promise.all(stale.map((t) => window.beatfx.readMeta(t.path).catch(() => null))).then((refreshed) => {
            const updates = new Map<string, TrackMeta>();
            refreshed.forEach((meta, i) => {
              if (meta) updates.set(stale[i].path, { ...meta, lyrics: stale[i].lyrics ?? meta.lyrics });
            });
            if (updates.size) setTracks((old) => old.map((t) => updates.get(t.path) ?? t));
          });
        }
      }
      if (savedEffects) setEffects(noEchoWithSurround({ ...DEFAULT_EFFECTS, ...savedEffects }));
    } catch { /* ignore broken storage */ }
    hydrated.current = true;

    return () => { window.clearTimeout(warmId); offs.forEach((off) => off()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 冷启动双击文件：先用文件名构造最小元数据立即加入并播放（不等封面/歌词解析），
  // 完整元数据随后在后台补齐。这样双击到出声只走 resolve + load，不再卡在 readMeta。
  function fastOpenAndPlay(paths: string[]) {
    if (!paths.length) return;
    const first = paths[0];
    const minimal: TrackMeta[] = paths.map((p) => {
      const name = p.split(/[\\/]/).pop() || p;
      const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
      return {
        path: p, name,
        title: name.slice(0, name.lastIndexOf('.') > 0 ? name.lastIndexOf('.') : undefined),
        artist: '', album: '', duration: 0,
        native: NATIVE_EXT.has(ext),
      };
    });
    setTracks((old) => {
      const seen = new Set(old.map((t) => t.path));
      const fresh = minimal.filter((t) => !seen.has(t.path));
      return fresh.length ? [...old, ...fresh] : old;
    });
    setPendingPlayPath(first);
    // 后台补全元数据（封面/歌词/时长/标签），逐首替换，不影响正在播放。
    Promise.all(paths.map((p) => window.beatfx.readMeta(p).catch(() => null))).then((metas) => {
      const updates = new Map<string, TrackMeta>();
      metas.forEach((m) => { if (m) updates.set(m.path, m); });
      if (updates.size) setTracks((old) => old.map((t) => updates.get(t.path) ?? t));
    });
  }

  async function addPaths(paths: string[]) {
    if (!paths.length) return;
    setStatus(`正在读取 ${paths.length} 个文件 …`);
    const metas = await Promise.all(paths.map((p) => window.beatfx.readMeta(p).catch(() => null)));
    const valid = metas.filter((m): m is TrackMeta => !!m);
    if (!valid.length) {
      setStatus('没有识别到可播放的音频文件');
      return;
    }
    const seen = new Set(tracks.map((t) => t.path));
    const fresh = valid.filter((t) => !seen.has(t.path));
    if (fresh.length) setTracks((old) => [...old, ...fresh]);
    setStatus(fresh.length
      ? `已加入 ${fresh.length} 首歌曲`
      : `这些歌曲已在列表中（扫描到 ${valid.length} 首）`);
  }

  const isFileDrag = (event: React.DragEvent) =>
    Array.from(event.dataTransfer?.types || []).includes('Files');

  const handleDragEnter = (event: React.DragEvent) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDragOver(true);
  };
  const handleDragOver = (event: React.DragEvent) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  };
  const handleDragLeave = (event: React.DragEvent) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragOver(false);
  };
  // 拖拽项取路径：优先用 Electron 的原生接口；文件夹条目若取不到绝对路径，
  // 再用 FileSystemEntry 递归到里面的音频文件（兼容多级嵌套文件夹）。
  const pathsFromDrop = useCallback(async (dt: DataTransfer | null): Promise<string[]> => {
    if (!dt) return [];
    const native = Array.from(dt.files || [])
      .map((file) => window.beatfx.getPathForFile(file) || (file as File & { path?: string }).path || '')
      .filter(Boolean);
    if (native.length) return native;

    const readEntry = (entry: FileSystemEntry): Promise<string[]> => new Promise((resolve) => {
      if (entry.isFile) {
        (entry as FileSystemFileEntry).file((file) => {
          const p = window.beatfx.getPathForFile(file) || (file as File & { path?: string }).path || '';
          resolve(p ? [p] : []);
        }, () => resolve([]));
      } else if (entry.isDirectory) {
        const reader = (entry as FileSystemDirectoryEntry).createReader();
        const found: string[] = [];
        const readBatch = () => reader.readEntries(async (batch) => {
          if (!batch.length) { resolve(found); return; }
          const groups = await Promise.all(Array.from(batch).map(readEntry));
          groups.forEach((g) => found.push(...g));
          readBatch();
        }, () => resolve(found));
        readBatch();
      } else resolve([]);
    });
    const entries = Array.from(dt.items || [])
      .map((item) => item.webkitGetAsEntry?.())
      .filter((entry): entry is FileSystemEntry => !!entry);
    const groups = await Promise.all(entries.map(readEntry));
    return groups.flat().filter(Boolean);
  }, []);

  const handleDrop = async (event: React.DragEvent) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    dragDepth.current = 0;
    setDragOver(false);
    const dropped = await pathsFromDrop(event.dataTransfer);
    if (!dropped.length) {
      setStatus('没有识别到拖入的文件，可改用左上角「添加文件夹」');
      return;
    }
    const audio = await window.beatfx.scanPaths(dropped);
    if (!audio.length) {
      setStatus('拖入的内容里没有可播放的音频');
      return;
    }
    await addPaths(audio);
  };

  const openFiles = async () => {
    const result = await window.beatfx.openFiles();
    if (!result.canceled) await addPaths(result.paths);
  };
  const openFolder = async () => {
    const result = await window.beatfx.openFolder();
    if (result.canceled) return;
    if (!result.paths.length) {
      setStatus('所选文件夹及其子文件夹里没有找到音频文件');
      return;
    }
    await addPaths(result.paths);
  };

  const revealTrack = useCallback(async (path: string) => {
    setContextMenu(null);
    try {
      const result = await window.beatfx.revealFile(path);
      setStatus(result === 'file' ? '已在文件管理器中定位歌曲'
        : result === 'folder' ? '歌曲已移动，已打开所在文件夹'
          : '歌曲和所在文件夹都已不存在');
    } catch {
      setStatus('无法打开歌曲所在位置');
    }
  }, []);

  const removeTrack = useCallback((path: string) => {
    const index = tracks.findIndex((t) => t.path === path);
    if (index < 0) return;
    const track = tracks[index];
    if (current === index) {
      engine.pause();
      setPlaying(false);
      setCurrent(null);
      setTime(0);
      setDuration(0);
    } else if (current !== null && index < current) {
      setCurrent(current - 1);
    }
    setTracks((old) => old.filter((t) => t.path !== path));
    setPendingPlayPath((p) => (p === path ? null : p));
    setContextMenu(null);
    setStatus(`已从列表移除「${track.title}」，原文件未删除`);
  }, [tracks, current, engine]);

  const clearLibrary = useCallback(() => {
    const count = tracks.length;
    engine.pause();
    setPlaying(false);
    setTracks([]);
    setCurrent(null);
    setTime(0);
    setDuration(0);
    setPendingPlayPath(null);
    setContextMenu(null);
    setStatus(`已清空播放列表（${count} 首），原文件未删除`);
  }, [tracks.length, engine]);

  const openLyricEditor = useCallback((path: string) => {
    const track = tracks.find((t) => t.path === path);
    if (!track) return;
    setLyricDraft(track.lyrics || '');
    setWriteLrcFile(true);
    setContextMenu(null);
    setLyricEditor({ path, title: track.title });
  }, [tracks]);

  const saveLyrics = useCallback(async () => {
    if (!lyricEditor) return;
    const clean = lyricDraft.replace(/\r\n?/g, '\n').trim();
    const { path, title } = lyricEditor;
    setTracks((old) => old.map((t) =>
      t.path === path ? { ...t, lyrics: clean || undefined } : t));
    setLyricEditor(null);
    if (!writeLrcFile) {
      setStatus(clean ? `歌词已保存到曲库 · ${title}` : `已清空「${title}」的歌词`);
      return;
    }
    const result = clean
      ? await window.beatfx.saveLyrics(path, clean)
      : await window.beatfx.removeLyrics(path);
    if (result.ok) {
      setStatus(clean
        ? result.overwrote ? `歌词已保存并覆盖同名 .lrc · ${title}` : `歌词已保存并写入同名 .lrc · ${title}`
        : `已清空歌词并删除同名 .lrc · ${title}`);
    } else {
      setStatus(clean
        ? `歌词已保存到曲库，但写入 .lrc 失败：${result.error}`
        : `歌词已从曲库清除，但删除 .lrc 失败：${result.error}`);
    }
  }, [lyricEditor, lyricDraft, writeLrcFile]);

  useEffect(() => {
    if (!lyricEditor) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLyricEditor(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [lyricEditor]);

  const openTrackMenu = useCallback((event: React.MouseEvent, path: string) => {
    event.preventDefault();
    const width = 216;
    const height = 214;
    setContextMenu({
      path,
      confirmClear: false,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8)),
    });
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    const onMouseDown = (event: MouseEvent) => {
      if ((event.target as HTMLElement | null)?.closest('.track-context-menu')) return;
      close();
    };
    const list = document.querySelector('.track-list');
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    list?.addEventListener('scroll', close, { passive: true });
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
      list?.removeEventListener('scroll', close);
    };
  }, [contextMenu]);

  const togglePlay = async () => {
    if (current === null) {
      if (tracks.length) playIndex(0);
      return;
    }
    if (playing) engine.pause();
    else {
      try { await engine.play(); } catch { setStatus('无法播放，请重新选择文件'); }
    }
  };
  const togglePlayRef = useRef(togglePlay);
  togglePlayRef.current = togglePlay;

  // 左右方向键：短按跳 5 秒，长按连续快进/快退并逐渐加速。
  // 空格键：播放 / 暂停切换。
  useEffect(() => {
    const audioOf = () => engine.audio;
    const seekBy = (delta: number) => {
      const audio = audioOf();
      const dur = audio.duration;
      if (!Number.isFinite(dur) || dur <= 0) return;
      const next = Math.max(0, Math.min(dur, audio.currentTime + delta));
      engine.seek(next);
      setTime(next);
    };
    const isTyping = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
    };

    const hold = {
      dir: 0,
      startedAt: 0,
      longPressTimer: 0,
      raf: 0,
      lastFrame: 0,
      speed: 0,
      active: false,
    };

    const stopHold = () => {
      if (hold.longPressTimer) { window.clearTimeout(hold.longPressTimer); hold.longPressTimer = 0; }
      if (hold.raf) { cancelAnimationFrame(hold.raf); hold.raf = 0; }
      hold.active = false;
    };

    const tick = (now: number) => {
      if (!hold.active) return;
      const dt = Math.min(0.05, (now - hold.lastFrame) / 1000);
      hold.lastFrame = now;
      // 长按速度从 4x 平滑加速到 20x
      hold.speed = Math.min(20, hold.speed + dt * 9);
      seekBy(hold.dir * hold.speed * dt);
      hold.raf = requestAnimationFrame(tick);
    };

    const beginLongPress = () => {
      if (!hold.active) return;
      hold.speed = 4;
      hold.lastFrame = performance.now();
      hold.raf = requestAnimationFrame(tick);
      setStatus(hold.dir > 0 ? '快进中 »' : '« 快退中');
    };

    const onKeyDown = (event: KeyboardEvent) => {
      // 空格：播放 / 暂停。输入框、弹窗、右键菜单里不拦截，已聚焦按钮交给按钮自身处理。
      if (event.code === 'Space' || event.key === ' ') {
        if (isTyping(event.target) || lyricEditorRef.current || contextMenuRef.current) return;
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        const target = event.target as HTMLElement | null;
        if (target?.tagName === 'BUTTON' || target?.tagName === 'A') return;
        event.preventDefault();
        // 忽略长按空格产生的重复事件，避免来回切换
        if (!event.repeat) void togglePlayRef.current();
        return;
      }
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      if (isTyping(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
      const audio = audioOf();
      if (currentRef.current === null || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
      event.preventDefault();
      if (hold.active) return;
      hold.dir = event.key === 'ArrowRight' ? 1 : -1;
      hold.active = true;
      hold.longPressTimer = window.setTimeout(beginLongPress, 320);
    };

    const finish = () => {
      if (!hold.active) return;
      const wasLongPress = hold.raf !== 0;
      stopHold();
      if (!wasLongPress) {
        seekBy(hold.dir * 5);
        setStatus(`跳转 ${hold.dir > 0 ? '+5s' : '-5s'}`);
      } else {
        setStatus(hold.dir > 0 ? '快进结束' : '快退结束');
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      if (!hold.active) return;
      event.preventDefault();
      finish();
    };
    const onBlur = () => { if (hold.active) { stopHold(); } };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      stopHold();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [engine]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tracks;
    return tracks.filter((t) =>
      [t.title, t.artist, t.album, t.name].some((v) => v.toLowerCase().includes(q)));
  }, [tracks, query]);
  const searching = query.trim().length > 0;

  // 按文件夹分组，保持曲库添加顺序（每个文件夹内也按加入顺序），便于折叠/展开。
  const folderGroups = useMemo(() => {
    const map = new Map<string, TrackMeta[]>();
    for (const track of filtered) {
      const folder = folderOf(track);
      const list = map.get(folder);
      if (list) list.push(track);
      else map.set(folder, [track]);
    }
    return [...map.entries()].map(([folder, items]) => ({ folder, items }));
  }, [filtered]);

  const toggleFolder = (folder: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
  };

  // 随机播放 / 自动下一首后，让左侧列表真正"跳到"当前歌曲：
  // 若它所在的文件夹被折叠则自动展开，并把列表滚动到该行。
  useEffect(() => {
    if (current === null) return;
    const track = tracks[current];
    if (!track) return;
    if (!searching) {
      const folder = folderOf(track);
      setCollapsedFolders((prev) => {
        if (!prev.has(folder)) return prev;
        const next = new Set(prev);
        next.delete(folder);
        return next;
      });
    }
    const timer = window.setTimeout(() => {
      const list = document.querySelector<HTMLElement>('.track-list');
      const active = list?.querySelector<HTMLElement>('.track-row.active');
      if (!list || !active) return;
      const listRect = list.getBoundingClientRect();
      const rowRect = active.getBoundingClientRect();
      const delta = (rowRect.top + rowRect.height / 2) - (listRect.top + listRect.height / 2);
      if (Math.abs(delta) > 4) list.scrollTo({ top: list.scrollTop + delta, behavior: 'smooth' });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [current, searching, tracks]);

  const currentTrack = current !== null ? tracks[current] : null;
  const lyricLines = useMemo(() => parseLyrics(currentTrack?.lyrics), [currentTrack?.lyrics]);
  const activeLine = useMemo(() => {
    let index = -1;
    for (let i = 0; i < lyricLines.length; i++) {
      if (lyricLines[i].time >= 0 && lyricLines[i].time <= time + 0.12) index = i;
      else break;
    }
    return index;
  }, [lyricLines, time]);

  useEffect(() => {
    if (!showLyrics || activeLine < 0) return;
    const box = lyricBoxRef.current;
    if (!box) return;
    const el = box.querySelector<HTMLElement>(`[data-line="${activeLine}"]`);
    if (el) box.scrollTo({ top: el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2, behavior: 'smooth' });
  }, [activeLine, showLyrics]);

  const renderTrack = (track: TrackMeta) => {
    const realIndex = tracks.indexOf(track);
    const active = realIndex === current;
    const h = hue(track.title);
    return (
      <button
        key={track.path}
        className={`track-row ${active ? 'active' : ''} ${contextMenu?.path === track.path ? 'menu-target' : ''}`}
        onClick={() => playIndex(realIndex)}
        onPointerEnter={() => prefetchTrack(track)}
        onContextMenu={(event) => openTrackMenu(event, track.path)}
        title="右键可打开所在位置或移出列表"
      >
        <span
          className="track-cover"
          style={track.cover
            ? { backgroundImage: `url(${track.cover})` }
            : { background: `linear-gradient(135deg, hsl(${h} 75% 52%), hsl(${(h + 70) % 360} 75% 42%))` }}
        >
          {!track.cover && <Music2 size={16} />}
        </span>
        <span className="track-info">
          <span className="track-title">{track.title}</span>
          <span className="track-artist">{track.artist || track.album || '未知歌手'}</span>
        </span>
        <span className="track-duration">{fmt(track.duration)}</span>
        {active && <span className="playing-dot" />}
      </button>
    );
  };

  const progress = duration > 0 ? (time / duration) * 100 : 0;
  const update = (patch: Partial<EffectsState>) => {
    setPreset('自定义');
    setEffects((old) => noEchoWithSurround({ ...old, ...patch }));
  };
  const applyPreset = (name: string) => {
    const found = PRESETS.find((p) => p.name === name);
    if (!found) return;
    setPreset(name);
    setEffects(noEchoWithSurround({ ...DEFAULT_EFFECTS, ...found.values }));
    setStatus(`已应用音效：${name}`);
  };

  return (
    <div
      className={`app-shell ${dragOver ? 'dragging' : ''}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <header className={`titlebar ${window.beatfx.platform === 'darwin' ? 'mac' : 'win'}`}>
        <div className="brand">
          <span className="brand-mark"><WaveMark size={19} /></span>
          <span className="brand-name">BeatFX</span>
          <span className="brand-sub">本地音乐 · 音效实验室</span>
        </div>
        <div className="titlebar-right">
          <div className="theme-switch">
            <button
              className={`theme-trigger ${themeMenu ? 'open' : ''}`}
              onClick={() => setThemeMenu((v) => !v)}
              title="切换外观皮肤"
            >
              <Palette size={14} />
              <span>{THEMES.find((t) => t.id === theme)?.label}</span>
              <ChevronDown size={11} />
            </button>
            {themeMenu && (
              <div className="theme-menu">
                <div className="theme-menu-title">外观皮肤</div>
                {THEMES.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    className={theme === id ? 'active' : ''}
                    onClick={() => {
                      setTheme(id);
                      setThemeMenu(false);
                      setStatus(`已切换外观：${label}`);
                    }}
                  >
                    <Icon size={14} />
                    <span>{label}</span>
                    {theme === id && <Check size={13} />}
                  </button>
                ))}
              </div>
            )}
          </div>
          {window.beatfx.platform !== 'darwin' && (
            <div className="window-controls">
              <button onClick={() => window.beatfx.windowAction('minimize')} title="最小化"><Minus size={15} /></button>
              <button onClick={() => window.beatfx.windowAction('maximize')} title="最大化"><Square size={12} /></button>
              <button className="close" onClick={() => window.beatfx.windowAction('close')} title="关闭"><X size={15} /></button>
            </div>
          )}
        </div>
      </header>

      <div className="layout">
        <aside className="sidebar">
          {dragOver && (
            <div className="drop-overlay">
              <FolderOpen size={38} strokeWidth={1.5} />
              <strong>松开加入曲库</strong>
              <span>支持音频文件和文件夹</span>
            </div>
          )}
          <div className="sidebar-head">
            <h2>我的音乐</h2>
            <span className="count">{tracks.length} 首</span>
          </div>
          <div className="library-actions">
            <button className="btn primary" onClick={openFiles}><FileAudio2 size={16} /> 添加文件</button>
            <button className="btn" onClick={openFolder}><FolderOpen size={16} /> 添加文件夹</button>
          </div>
          <div className="search-box">
            <Search size={15} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索歌曲、歌手、专辑" />
          </div>
          <div className="track-list">
            {filtered.length === 0 && (
              <div className="empty-library">
                <Disc3 size={42} />
                <p>还没有歌曲</p>
                <span>点击上方按钮，或从桌面拖入音频文件 / 文件夹</span>
              </div>
            )}
            {searching
              ? filtered.map(renderTrack)
              : folderGroups.map(({ folder, items }) => {
                const collapsed = collapsedFolders.has(folder);
                const activeInGroup = items.some((t) => tracks.indexOf(t) === current);
                return (
                  <div className="folder-group" key={folder}>
                    <button
                      className={`folder-head ${collapsed ? 'collapsed' : ''} ${activeInGroup ? 'has-active' : ''}`}
                      onClick={() => toggleFolder(folder)}
                      title={folder}
                    >
                      <ChevronRight size={14} className="folder-chevron" />
                      <FolderOpen size={15} />
                      <span className="folder-name">{folderLabel(folder)}</span>
                      <span className="folder-count">{items.length}</span>
                    </button>
                    {!collapsed && <div className="folder-tracks">{items.map(renderTrack)}</div>}
                  </div>
                );
              })}
          </div>
          <div className="format-note">
            <Waves size={14} />
            <span>支持 MP3 / M4A / FLAC / WAV / OGG / APE / WMA 等，非原生格式自动转码播放</span>
          </div>
        </aside>

        <main className="stage">
          <div className="stage-glow" />
          {showLyrics ? (
            <div className="lyrics-wrap" ref={lyricBoxRef}>
              {lyricLines.length ? (
                <div className="lyrics-lines">
                  {lyricLines.map((line, i) => (
                    <div key={`${i}-${line.time}`} data-line={i}
                      className={`lyric-line ${i === activeLine ? 'active' : ''}`}>
                      {line.text || '♪'}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="lyrics-empty">
                  <ListMusic size={38} strokeWidth={1.4} />
                  <p>这首歌还没有歌词</p>
                  <span>支持 LRC 时间轴，可直接添加并写入同名 .lrc 文件</span>
                  {currentTrack && (
                    <button className="view-toggle" onClick={() => openLyricEditor(currentTrack.path)}>
                      <FileText size={13} /> 添加歌词
                    </button>
                  )}
                </div>
              )}
              {loading && <div className="cover-loading"><LoaderCircle size={30} className="spin" /></div>}
            </div>
          ) : (
            <div className="cover-wrap">
              <div
                className="cover-large"
                style={currentTrack?.cover
                  ? { backgroundImage: `url(${currentTrack.cover})` }
                  : { background: `linear-gradient(145deg, hsl(${hue(currentTrack?.title || 'BeatFX')} 72% 48%), hsl(${(hue(currentTrack?.title || 'BeatFX') + 80) % 360} 72% 30%))` }}
              >
                {!currentTrack?.cover && <Disc3 size={78} strokeWidth={1.2} />}
                {loading && <div className="cover-loading"><LoaderCircle size={30} className="spin" /></div>}
              </div>
            </div>
          )}

          <div className="now-playing">
            <h1>{currentTrack?.title || '选择一首歌开始'}</h1>
            <p>{currentTrack ? [currentTrack.artist, currentTrack.album].filter(Boolean).join(' · ') : 'BeatFX · 让每一首歌都有自己的味道'}</p>
            <div className="now-actions">
              <button className="view-toggle" onClick={() => setShowLyrics((v) => !v)}>
                {showLyrics ? <Disc3 size={13} /> : <ListMusic size={13} />}
                {showLyrics ? '显示封面' : '显示歌词'}
              </button>
              {currentTrack && (
                <button className="view-toggle" onClick={() => openLyricEditor(currentTrack.path)}>
                  <FileText size={13} /> 编辑歌词
                </button>
              )}
            </div>
          </div>

          <Visualizer engine={engine} playing={playing} />

          <div className="progress-area">
            <span className="time">{fmt(time)}</span>
            <input
              className="progress" type="range" min={0} max={Math.max(duration, 0.1)} step={0.1}
              value={Math.min(time, Math.max(duration, 0.1))}
              style={{ '--pct': `${progress}%` } as React.CSSProperties}
              onChange={(e) => { const v = Number(e.target.value); engine.seek(v); setTime(v); }}
            />
            <span className="time">{fmt(duration)}</span>
          </div>

          <div className="transport">
            <button className={`icon-btn ${shuffle ? 'on' : ''}`} onClick={() => setShuffle((v) => !v)} title="随机播放"><Shuffle size={18} /></button>
            <button className="icon-btn" onClick={prev} title="上一首"><SkipBack size={25} fill="currentColor" /></button>
            <button className="play-btn" onClick={togglePlay} title={playing ? '暂停' : '播放'}>
              {playing ? <Pause size={30} fill="currentColor" /> : <Play size={30} fill="currentColor" style={{ marginLeft: 3 }} />}
            </button>
            <button className="icon-btn" onClick={() => next()} title="下一首"><SkipForward size={25} fill="currentColor" /></button>
            <button className={`icon-btn ${repeat !== 'off' ? 'on' : ''}`}
              onClick={() => setRepeat((r) => r === 'off' ? 'all' : r === 'all' ? 'one' : 'off')}
              title={`循环：${repeat}`}>
              {repeat === 'one' ? <Repeat1 size={18} /> : <Repeat size={18} />}
            </button>
          </div>

          <div className="key-hint">空格 播放/暂停 · ← → 短按跳转 5 秒 · 长按连续快进/快退</div>

          <div className="bottom-row">
            <div className="volume">
              <Volume2 size={16} />
              <input type="range" min={0} max={1} step={0.01} value={volume}
                style={{ '--pct': `${volume * 100}%` } as React.CSSProperties}
                onChange={(e) => setVolume(Number(e.target.value))} />
            </div>
            <span className="status">{status}</span>
            <span className="version">v{version} · by Joly</span>
            <button className="check-update" onClick={handleCheckUpdate}
              disabled={checkingUpdate} title="检查 GitHub 发布页是否有新版本">
              {checkingUpdate ? '检查中…' : '检查更新'}
            </button>
          </div>
        </main>

        <aside className="fx-panel">
          <div className="fx-head">
            <div><SlidersHorizontal size={18} /><strong>音效实验室</strong></div>
            <button className="reset" onClick={() => { setPreset('原声'); setEffects(DEFAULT_EFFECTS); resetDj(); }}><RotateCcw size={14} /> 重置</button>
          </div>
          <p className="fx-hint">专业级调音，实时生效 · 当前：<b>{preset}</b></p>

          <div className="preset-grid">
            {PRESETS.map((p) => (
              <button key={p.name} className={`preset ${preset === p.name ? 'active' : ''}`} onClick={() => applyPreset(p.name)}>
                <span>{p.emoji}</span>{p.name}
              </button>
            ))}
          </div>

          <section className="fx-section">
            <h3><Waves size={15} /> 均衡器 <small>EQ</small></h3>
            <Slider label="低频" value={effects.low} min={-18} max={18} step={1}
              format={(v) => `${v > 0 ? '+' : ''}${v} dB`} onChange={(v) => update({ low: v })} />
            <Slider label="中频" value={effects.mid} min={-18} max={18} step={1}
              format={(v) => `${v > 0 ? '+' : ''}${v} dB`} onChange={(v) => update({ mid: v })} />
            <Slider label="高频" value={effects.high} min={-18} max={18} step={1}
              format={(v) => `${v > 0 ? '+' : ''}${v} dB`} onChange={(v) => update({ high: v })} />
            <Slider label="重低音" value={effects.bass} min={-18} max={18} step={1}
              format={(v) => `${v > 0 ? '+' : ''}${v} dB`} onChange={(v) => update({ bass: v })} />
          </section>

          <section className="fx-section">
            <h3><Radio size={15} /> 空间音效</h3>
            <Slider label="混响" value={effects.reverb} min={0} max={1} step={0.01}
              format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => update({ reverb: v })} />
            <Slider label="回声" value={effects.echo} min={0} max={1} step={0.01}
              format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => update({ echo: v })} />
            <Slider label="环绕旋转" value={effects.surround ?? 0} min={0} max={1} step={0.01}
              format={(v) => (v > 0 ? `${Math.round(v * 100)}%` : '关')} onChange={(v) => update({ surround: v })} />
            <Slider label="变速" value={effects.speed} min={0.5} max={2} step={0.05}
              format={(v) => `${v.toFixed(2)}×`} onChange={(v) => update({ speed: v })} />
          </section>

          <section className="fx-section toggles">
            <h3><Zap size={15} /> 特色处理</h3>
            <button className={`toggle ${effects.vocal ? 'on' : ''}`} onClick={() => update({ vocal: !effects.vocal })}>
              <span className="toggle-dot" /> <span>人声消除 / 伴奏提取</span>
            </button>
            <button className={`toggle ${effects.limiter ? 'on' : ''}`} onClick={() => update({ limiter: !effects.limiter })}>
              <span className="toggle-dot" /> <span>智能限幅（防爆音）</span>
            </button>
          </section>

          <section className="fx-section dj-section">
            <h3><AudioLines size={15} /> DJ 打碟机 <small>悬停 / 点击</small></h3>
            <p className="dj-tip">前 5 个悬停 0.4 秒或按住生效，移开/松开还原；后 4 个点击开关</p>
            <div className="dj-grid">
              <button
                className={`dj-pad ${djMomentary.scratch ? 'on' : ''}`}
                {...momentaryProps('scratch')}
              >
                <Disc3 size={17} /><span>搓碟</span><small>悬停/按住</small>
              </button>
              <button
                className={`dj-pad ${djMomentary.filter ? 'on' : ''}`}
                {...momentaryProps('filter')}
              >
                <Activity size={17} /><span>滤波扫频</span><small>悬停/按住</small>
              </button>
              <button
                className={`dj-pad ${djMomentary.brake ? 'on' : ''}`}
                {...momentaryProps('brake')}
              >
                <Gauge size={17} /><span>黑胶刹车</span><small>悬停/按住</small>
              </button>
              <button
                className={`dj-pad ${djMomentary.siren ? 'on' : ''}`}
                {...momentaryProps('siren')}
              >
                <RadioTower size={17} /><span>警笛</span><small>悬停/按住</small>
              </button>
              <button
                className={`dj-pad ${djMomentary.repeat ? 'on' : ''}`}
                {...momentaryProps('repeat')}
              >
                <Repeat2 size={17} /><span>节拍循环</span><small>悬停/按住</small>
              </button>
              <button className={`dj-pad ${djToggle.noise ? 'on' : ''}`} onClick={() => toggleDj('noise')}>
                <Wind size={17} /><span>噪声</span><small>点击</small>
              </button>
              <button className={`dj-pad ${djToggle.flanger ? 'on' : ''}`} onClick={() => toggleDj('flanger')}>
                <AudioWaveform size={17} /><span>镶边</span><small>点击</small>
              </button>
              <button className={`dj-pad ${djToggle.phaser ? 'on' : ''}`} onClick={() => toggleDj('phaser')}>
                <Sparkles size={17} /><span>移相</span><small>点击</small>
              </button>
              <button className={`dj-pad ${djToggle.crusher ? 'on' : ''}`} title="LO-FI 低保真：把音质压成老收音机/8-bit 的颗粒感，点击开关" onClick={() => toggleDj('crusher')}>
                <VolumeX size={17} /><span>LO-FI</span><small>点击</small>
              </button>
            </div>
          </section>

          <div className="fx-foot"><Moon size={13} /> 所有音频处理均在本机完成，不上传任何数据</div>
        </aside>
      </div>

      {contextMenu && (
        <div
          className="track-context-menu"
          role="menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          {contextMenu.confirmClear ? (
            <>
              <div className="menu-warning">确定清空全部 {tracks.length} 首歌曲？</div>
              <div className="menu-actions">
                <button className="ghost"
                  onClick={() => setContextMenu((m) => (m ? { ...m, confirmClear: false } : null))}>取消</button>
                <button className="danger solid" onClick={clearLibrary}>确认清空</button>
              </div>
              <div className="menu-note">只清空播放列表，不会删除原文件</div>
            </>
          ) : (
            <>
              <button role="menuitem" onClick={() => revealTrack(contextMenu.path)}>
                <FolderOpen size={15} /> 打开歌曲所在位置
              </button>
              <button role="menuitem" onClick={() => openLyricEditor(contextMenu.path)}>
                <FileText size={15} /> 编辑歌词
              </button>
              <button role="menuitem" className="danger" onClick={() => removeTrack(contextMenu.path)}>
                <Trash2 size={15} /> 从列表移除
              </button>
              <button role="menuitem" className="danger" onClick={() =>
                setContextMenu((m) => (m ? { ...m, confirmClear: true } : null))}>
                <ListX size={15} /> 清空列表
              </button>
              <div className="menu-note">仅移出播放列表，不会删除原文件</div>
            </>
          )}
        </div>
      )}

      {lyricEditor && (
        <div className="modal-backdrop"
          onMouseDown={(event) => { if (event.target === event.currentTarget) setLyricEditor(null); }}>
          <div className="lyric-modal" role="dialog" aria-modal="true" aria-label={`编辑歌词 · ${lyricEditor.title}`}>
            <div className="modal-head">
              <div>
                <FileText size={17} />
                <strong>编辑歌词</strong>
                <span>{lyricEditor.title}</span>
              </div>
              <button className="modal-close" onClick={() => setLyricEditor(null)} title="关闭"><X size={16} /></button>
            </div>
            <textarea
              className="lyric-input"
              value={lyricDraft}
              onChange={(event) => setLyricDraft(event.target.value)}
              placeholder={'[00:00.00] 第一句歌词\n[00:04.00] 第二句歌词'}
              spellCheck={false}
              autoFocus
            />
            <div className="lyric-help">支持 LRC 时间轴，保存后播放时会同步高亮；纯文本也能保存，但不会随时间滚动。</div>
            <label className="lyric-check">
              <input type="checkbox" checked={writeLrcFile}
                onChange={(event) => setWriteLrcFile(event.target.checked)} />
              <span>同时写入同名 .lrc 文件到歌曲目录（会覆盖已有文件；清空歌词时删除该文件）</span>
            </label>
            <div className="modal-actions">
              <button onClick={() => setLyricEditor(null)}>取消</button>
              <button className="primary" onClick={saveLyrics}>保存歌词</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
