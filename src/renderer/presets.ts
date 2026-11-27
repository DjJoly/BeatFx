export interface EffectsState {
  low: number;
  mid: number;
  high: number;
  bass: number;
  reverb: number;
  echo: number;
  surround: number;
  vocal: boolean;
  limiter: boolean;
  speed: number;
}

export const DEFAULT_EFFECTS: EffectsState = {
  low: 0,
  mid: 0,
  high: 0,
  bass: 0,
  reverb: 0,
  echo: 0,
  surround: 0,
  vocal: false,
  limiter: true,
  speed: 1,
};

export interface Preset {
  name: string;
  emoji: string;
  values: Partial<EffectsState>;
}

export const PRESETS: Preset[] = [
  { name: '原声', emoji: '🎧', values: {} },
  { name: '热力流行', emoji: '🔥', values: { low: 4, mid: -1, high: 3, bass: 6, reverb: 0.2, echo: 0.12 } },
  { name: '低音炮', emoji: '🔊', values: { low: 7, mid: -3, high: 1, bass: 10, reverb: 0.1 } },
  { name: '人声清晰', emoji: '🎤', values: { low: -2, mid: 5, high: 4, bass: -1, reverb: 0.08 } },
  { name: '伴奏模式', emoji: '🎼', values: { low: 1, mid: 1, high: 2, bass: 3, vocal: true } },
  { name: '电音节奏', emoji: '⚡', values: { low: 3, mid: -2, high: 5, bass: 5, reverb: 0.12, echo: 0.1 } },
  { name: '环绕现场', emoji: '🌌', values: { low: 1, mid: 0, high: 3, bass: 2, reverb: 0, echo: 0, surround: 0.9 } },
  { name: '深夜轻听', emoji: '🌙', values: { low: -3, mid: 1, high: -2, bass: -4, reverb: 0.12, limiter: true } },
];
