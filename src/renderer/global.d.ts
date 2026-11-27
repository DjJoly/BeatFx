import type { BeatFXApi } from '../types';

declare global {
  interface Window {
    beatfx: BeatFXApi;
  }
}

export {};
