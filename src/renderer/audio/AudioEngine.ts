export type Band = 'low' | 'mid' | 'high';

type Listener = (value?: number) => void;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Generate a decaying-noise impulse response for a simple convolution reverb. */
function makeImpulse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * seconds);
  const impulse = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const t = i / length;
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
    }
  }
  return impulse;
}

/** Quantised transfer curve that emulates reduced bit depth (LO-FI). */
function makeCrushCurve(bits = 5): Float32Array {
  const n = 4096;
  const curve = new Float32Array(n);
  const levels = Math.pow(2, bits);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.round(x * levels) / levels;
  }
  return curve;
}

export class AudioEngine {
  readonly audio = new Audio();
  private ctx!: AudioContext;
  private source!: MediaElementAudioSourceNode;
  private input!: GainNode;
  private bass!: BiquadFilterNode;
  private low!: BiquadFilterNode;
  private mid!: BiquadFilterNode;
  private high!: BiquadFilterNode;
  private dryReverb!: GainNode;
  private wetReverb!: GainNode;
  private convolver!: ConvolverNode;
  private echoInput!: GainNode;
  private dryEcho!: GainNode;
  private wetEcho!: GainNode;
  private delay!: DelayNode;
  private feedback!: GainNode;
  private echoHighpass!: BiquadFilterNode;
  private echoFilter!: BiquadFilterNode;
  private vocalPre!: GainNode;
  private vocalDry!: GainNode;
  private vocalWet!: GainNode;
  private splitter!: ChannelSplitterNode;
  private merger!: ChannelMergerNode;
  private invertA!: GainNode;
  private invertB!: GainNode;
  private passA!: GainNode;
  private passB!: GainNode;
  private compressor!: DynamicsCompressorNode;
  private loudnessComp!: GainNode;   // offsets low-end boost so the compressor does not pump
  private analyserNode!: AnalyserNode;
  private surroundPanner!: PannerNode;   // HRTF panner that orbits around the listener
  private surroundDry!: GainNode;
  private surroundWet!: GainNode;
  private surroundOscX!: OscillatorNode;
  private surroundOscZ!: OscillatorNode;
  private surroundRate = 0;
  private master!: GainNode;
  private bassDb = 0;
  private lowDb = 0;
  private graphReady = false;
  private listeners = new Map<string, Set<Listener>>();

  // ---- DJ effect nodes ----------------------------------------------------
  private flangerIn!: GainNode;
  private flangerOut!: GainNode;
  private flangerDry!: GainNode;
  private flangerWet!: GainNode;
  private flangerDelay!: DelayNode;
  private flangerLfo!: OscillatorNode;
  private flangerLfoGain!: GainNode;

  private phaserIn!: GainNode;
  private phaserOut!: GainNode;
  private phaserDry!: GainNode;
  private phaserWet!: GainNode;
  private phaserLfo!: OscillatorNode;
  private phaserLfoGain!: GainNode;
  private phaserFilters!: BiquadFilterNode[];

  private crusherIn!: GainNode;
  private crusherOut!: GainNode;
  private crusherDry!: GainNode;
  private crusherWet!: GainNode;
  private crusherShaper!: WaveShaperNode;
  private crusherTone!: BiquadFilterNode;

  private sweepFilter!: BiquadFilterNode;
  private repeatDelay!: DelayNode;
  private repeatFeedback!: GainNode;
  private repeatWet!: GainNode;

  private sirenOsc!: OscillatorNode;
  private sirenLfo!: OscillatorNode;
  private sirenLfoGain!: GainNode;
  private sirenGain!: GainNode;
  private noiseSource!: AudioBufferSourceNode;
  private noiseGain!: GainNode;

  private baseSpeed = 1;
  private scratchOn = false;
  private brakeOn = false;
  private sweepOn = false;
  private scratchFrame = 0;
  private brakeFrame = 0;
  private sweepTimer = 0;
  private scratchStart = 0;
  private brakeStarted = 0;
  private sweepPhase = 0;
  private originalPreservesPitch: boolean | null = null;

  /** Build the Web Audio graph ahead of the first click so playback isn't delayed. */
  warmup() {
    try { this.buildGraph(); } catch { /* will retry on first play */ }
  }

  constructor() {
    this.audio.preload = 'auto';
    // AudioContext is created lazily in buildGraph() on first playback to speed up startup.
    ['timeupdate', 'loadedmetadata', 'ended', 'play', 'pause', 'error', 'canplay'].forEach((name) => {
      this.audio.addEventListener(name, () => {
        this.listeners.get(name)?.forEach((cb) => cb());
      });
    });
  }

  on(name: string, cb: Listener) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name)!.add(cb);
    return () => this.listeners.get(name)?.delete(cb);
  }

  private buildGraph() {
    if (this.graphReady) return;
    if (!this.ctx) this.ctx = new AudioContext();
    const ctx = this.ctx;
    this.source = ctx.createMediaElementSource(this.audio);

    this.input = ctx.createGain();
    this.bass = ctx.createBiquadFilter();
    this.bass.type = 'lowshelf';
    this.bass.frequency.value = 80;
    this.low = ctx.createBiquadFilter();
    this.low.type = 'lowshelf';
    this.low.frequency.value = 220;
    this.mid = ctx.createBiquadFilter();
    this.mid.type = 'peaking';
    this.mid.frequency.value = 1200;
    this.mid.Q.value = 0.9;
    this.high = ctx.createBiquadFilter();
    this.high.type = 'highshelf';
    this.high.frequency.value = 4200;

    this.convolver = ctx.createConvolver();
    this.convolver.buffer = makeImpulse(ctx, 1.1, 3.2);
    this.dryReverb = ctx.createGain();
    this.wetReverb = ctx.createGain();
    this.wetReverb.gain.value = 0;

    this.delay = ctx.createDelay(1.0);
    this.delay.delayTime.value = 0.22;
    this.feedback = ctx.createGain();
    this.feedback.gain.value = 0.08;
    this.echoHighpass = ctx.createBiquadFilter();
    this.echoHighpass.type = 'highpass';
    this.echoHighpass.frequency.value = 180;
    this.echoFilter = ctx.createBiquadFilter();
    this.echoFilter.type = 'lowpass';
    this.echoFilter.frequency.value = 2400;
    this.echoInput = ctx.createGain();
    this.dryEcho = ctx.createGain();
    this.wetEcho = ctx.createGain();
    this.wetEcho.gain.value = 0;

    this.vocalPre = ctx.createGain();
    this.vocalDry = ctx.createGain();
    this.vocalWet = ctx.createGain();
    this.vocalWet.gain.value = 0;
    this.splitter = ctx.createChannelSplitter(2);
    this.merger = ctx.createChannelMerger(2);
    this.invertA = ctx.createGain();
    this.invertB = ctx.createGain();
    this.invertA.gain.value = -1;
    this.invertB.gain.value = -1;
    this.passA = ctx.createGain();
    this.passB = ctx.createGain();

    // Gentle safety limiter: a high threshold and slow-ish attack/release avoid
    // the audible "pumping" that aggressive compression causes on boosted bass.
    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -6;
    this.compressor.knee.value = 24;
    this.compressor.ratio.value = 3;
    this.compressor.attack.value = 0.02;
    this.compressor.release.value = 0.4;

    this.loudnessComp = ctx.createGain();
    this.loudnessComp.gain.value = 1;

    // ---- DJ: flanger (short modulated delay, mixed in parallel) -----------
    this.flangerIn = ctx.createGain();
    this.flangerOut = ctx.createGain();
    this.flangerDry = ctx.createGain();
    this.flangerWet = ctx.createGain();
    this.flangerWet.gain.value = 0;
    this.flangerDelay = ctx.createDelay(0.05);
    this.flangerDelay.delayTime.value = 0.004;
    this.flangerLfo = ctx.createOscillator();
    this.flangerLfo.frequency.value = 0.45;
    this.flangerLfoGain = ctx.createGain();
    this.flangerLfoGain.gain.value = 0.003;
    this.flangerLfo.connect(this.flangerLfoGain).connect(this.flangerDelay.delayTime);
    this.flangerLfo.start();
    this.flangerIn.connect(this.flangerDry).connect(this.flangerOut);
    this.flangerIn.connect(this.flangerDelay).connect(this.flangerWet).connect(this.flangerOut);

    // ---- DJ: phaser (4 all-pass stages swept by an LFO) -------------------
    this.phaserIn = ctx.createGain();
    this.phaserOut = ctx.createGain();
    this.phaserDry = ctx.createGain();
    this.phaserWet = ctx.createGain();
    this.phaserWet.gain.value = 0;
    this.phaserLfo = ctx.createOscillator();
    this.phaserLfo.frequency.value = 0.28;
    this.phaserLfoGain = ctx.createGain();
    this.phaserLfoGain.gain.value = 700;
    this.phaserLfo.connect(this.phaserLfoGain);
    this.phaserFilters = Array.from({ length: 4 }, () => {
      const f = ctx.createBiquadFilter();
      f.type = 'allpass';
      f.frequency.value = 900;
      f.Q.value = 1.2;
      this.phaserLfoGain.connect(f.frequency);
      return f;
    });
    this.phaserLfo.start();
    this.phaserIn.connect(this.phaserDry).connect(this.phaserOut);
    let tail: AudioNode = this.phaserIn;
    for (const f of this.phaserFilters) { tail.connect(f); tail = f; }
    tail.connect(this.phaserWet).connect(this.phaserOut);

    // ---- DJ: LO-FI bit crusher (quantising waveshaper) --------------------
    this.crusherIn = ctx.createGain();
    this.crusherOut = ctx.createGain();
    this.crusherDry = ctx.createGain();
    this.crusherWet = ctx.createGain();
    this.crusherWet.gain.value = 0;
    this.crusherShaper = ctx.createWaveShaper();
    this.crusherShaper.curve = makeCrushCurve(3);
    this.crusherShaper.oversample = 'none';
    this.crusherTone = ctx.createBiquadFilter();
    this.crusherTone.type = 'lowpass';
    this.crusherTone.frequency.value = 4200;
    this.crusherTone.Q.value = 0.7;
    this.crusherIn.connect(this.crusherDry).connect(this.crusherOut);
    this.crusherIn.connect(this.crusherShaper).connect(this.crusherTone).connect(this.crusherWet).connect(this.crusherOut);

    // ---- DJ: filter sweep + beat repeat -----------------------------------
    this.sweepFilter = ctx.createBiquadFilter();
    this.sweepFilter.type = 'lowpass';
    this.sweepFilter.frequency.value = 20000;
    this.sweepFilter.Q.value = 1.4;
    this.repeatDelay = ctx.createDelay(1.0);
    this.repeatDelay.delayTime.value = 0.26;
    this.repeatFeedback = ctx.createGain();
    this.repeatFeedback.gain.value = 0;
    this.repeatWet = ctx.createGain();
    this.repeatWet.gain.value = 0;

    // ---- DJ: siren + noise generators (run quietly into master) -----------
    this.sirenOsc = ctx.createOscillator();
    this.sirenOsc.type = 'sawtooth';
    this.sirenOsc.frequency.value = 620;
    this.sirenLfo = ctx.createOscillator();
    this.sirenLfo.frequency.value = 0.8;
    this.sirenLfoGain = ctx.createGain();
    this.sirenLfoGain.gain.value = 380;
    this.sirenLfo.connect(this.sirenLfoGain).connect(this.sirenOsc.frequency);
    this.sirenGain = ctx.createGain();
    this.sirenGain.gain.value = 0;

    const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = noiseBuffer.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    this.noiseSource = ctx.createBufferSource();
    this.noiseSource.buffer = noiseBuffer;
    this.noiseSource.loop = true;
    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = 0;

    this.analyserNode = ctx.createAnalyser();
    this.analyserNode.fftSize = 2048;
    this.analyserNode.smoothingTimeConstant = 0.82;

    // ---- Surround: an HRTF panner whose source orbits the listener --------
    // Two quadrature LFOs drive the X/Z position so the sound travels a full
    // circle (front -> side -> back -> side) instead of merely bouncing L/R.
    this.surroundPanner = ctx.createPanner();
    this.surroundPanner.panningModel = 'HRTF';
    this.surroundPanner.distanceModel = 'inverse';
    this.surroundPanner.refDistance = 1;
    this.surroundPanner.maxDistance = 100;
    this.surroundPanner.rolloffFactor = 0; // position is for direction only, no volume fade
    this.surroundPanner.positionY.value = 0; // ear level
    this.surroundPanner.positionX.value = 0;
    this.surroundPanner.positionZ.value = 0;

    this.surroundOscX = ctx.createOscillator();
    this.surroundOscX.type = 'sine';
    this.surroundOscX.frequency.value = 0.11; // ~9 s per revolution
    const orbitXGain = ctx.createGain();
    orbitXGain.gain.value = 2.2; // orbit radius
    this.surroundOscX.connect(orbitXGain).connect(this.surroundPanner.positionX);
    this.surroundOscX.start();

    this.surroundOscZ = ctx.createOscillator();
    const cosReal = new Float32Array([0, 1]);
    const cosImag = new Float32Array([0, 0]);
    this.surroundOscZ.setPeriodicWave(ctx.createPeriodicWave(cosReal, cosImag, { disableNormalization: true }));
    this.surroundOscZ.frequency.value = 0.11;
    const orbitZGain = ctx.createGain();
    orbitZGain.gain.value = 2.2;
    this.surroundOscZ.connect(orbitZGain).connect(this.surroundPanner.positionZ);
    this.surroundOscZ.start();

    this.surroundDry = ctx.createGain();
    this.surroundWet = ctx.createGain();
    this.surroundWet.gain.value = 0;

    this.master = ctx.createGain();

    // Core chain (existing EQ) -> DJ insert chain -> reverb/echo/vocal -> limiter
    this.source
      .connect(this.input)
      .connect(this.bass)
      .connect(this.low)
      .connect(this.mid)
      .connect(this.high)
      .connect(this.loudnessComp)
      .connect(this.flangerIn);
    this.flangerOut.connect(this.phaserIn);
    this.phaserOut.connect(this.crusherIn);
    this.crusherOut.connect(this.sweepFilter);

    // Reverb is inserted in-line: the dry gain carries the main signal and the
    // convolution branch adds the wet layer, then both converge before the
    // echo stage. Previously both reverb gains had no outgoing connection at
    // all, so the reverb control produced no sound.
    this.sweepFilter.connect(this.dryReverb).connect(this.echoInput);
    this.sweepFilter.connect(this.convolver).connect(this.wetReverb).connect(this.echoInput);

    // Beat-repeat parallel path (dry stays on the reverb chain)
    this.sweepFilter.connect(this.repeatDelay);
    this.repeatDelay.connect(this.repeatFeedback).connect(this.repeatDelay);
    this.repeatDelay.connect(this.repeatWet).connect(this.compressor);

    // Echo input is fed by the reverb stage above (no second direct path), so
    // the original signal never reaches the mix twice.
    this.echoInput.connect(this.dryEcho).connect(this.vocalPre);
    this.echoInput.connect(this.delay);
    this.delay.connect(this.echoHighpass).connect(this.echoFilter).connect(this.feedback).connect(this.delay);
    this.delay.connect(this.wetEcho).connect(this.vocalPre);

    // Vocal cancellation parallel mix
    this.vocalPre.connect(this.vocalDry).connect(this.compressor);
    this.vocalPre.connect(this.splitter);
    this.splitter.connect(this.passA, 0);
    this.splitter.connect(this.invertB, 1);
    this.splitter.connect(this.invertA, 0);
    this.splitter.connect(this.passB, 1);
    this.passA.connect(this.merger, 0, 0);
    this.invertB.connect(this.merger, 0, 0);
    this.invertA.connect(this.merger, 0, 1);
    this.passB.connect(this.merger, 0, 1);
    this.merger.connect(this.vocalWet).connect(this.compressor);

    // Final mix: keep the original stereo (dry) and add an orbiting HRTF copy
    // (wet) so the source seems to travel around the head.
    this.compressor.connect(this.analyserNode);
    this.analyserNode.connect(this.surroundDry).connect(this.master);
    this.analyserNode.connect(this.surroundPanner).connect(this.surroundWet).connect(this.master);
    this.master.connect(ctx.destination);
    this.sirenOsc.connect(this.sirenGain).connect(this.master);
    this.noiseSource.connect(this.noiseGain).connect(this.master);
    this.sirenOsc.start();
    this.sirenLfo.start();
    this.noiseSource.start();

    this.graphReady = true;
  }

  async load(url: string) {
    this.stopMotionEffects();
    this.buildGraph();
    this.audio.src = url;
    this.audio.load();
  }

  async play() {
    this.buildGraph();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    await this.audio.play();
  }

  pause() { this.audio.pause(); }

  seek(seconds: number) {
    if (Number.isFinite(this.audio.duration)) {
      this.audio.currentTime = clamp(seconds, 0, this.audio.duration);
    }
  }

  setVolume(v: number) {
    this.buildGraph(); this.master.gain.value = clamp(v, 0, 1); }

  private applyPlaybackRate(rate: number) {
    this.audio.playbackRate = clamp(rate, 0.05, 4);
  }

  /** Turntable-style speed change: disable time-stretching so pitch follows speed. */
  private setTurntablePitch(enabled: boolean) {
    const el = this.audio as HTMLAudioElement & {
      webkitPreservesPitch?: boolean;
      mozPreservesPitch?: boolean;
    };
    if (enabled) {
      if (this.originalPreservesPitch === null) {
        this.originalPreservesPitch = el.preservesPitch ?? el.webkitPreservesPitch ?? true;
      }
      el.preservesPitch = false;
      if ('webkitPreservesPitch' in el) el.webkitPreservesPitch = false;
      if ('mozPreservesPitch' in el) el.mozPreservesPitch = false;
    } else if (this.originalPreservesPitch !== null) {
      el.preservesPitch = this.originalPreservesPitch;
      if ('webkitPreservesPitch' in el) el.webkitPreservesPitch = this.originalPreservesPitch;
      if ('mozPreservesPitch' in el) el.mozPreservesPitch = this.originalPreservesPitch;
      this.originalPreservesPitch = null;
    }
  }

  private easeInOutSine(t: number) {
    return -(Math.cos(Math.PI * clamp(t, 0, 1)) - 1) / 2;
  }

  private easeInOutCubic(t: number) {
    const x = clamp(t, 0, 1);
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  }

  setSpeed(v: number) {
    this.baseSpeed = clamp(v, 0.5, 2);
    if (!this.scratchOn && !this.brakeOn) this.applyPlaybackRate(this.baseSpeed);
  }

  /** Keep overall level steady when the low shelves are boosted. */
  private updateLoudnessComp() {
    const boostDb = Math.max(0, this.bassDb) * 0.35 + Math.max(0, this.lowDb) * 0.15;
    const gain = Math.pow(10, -boostDb / 20);
    this.loudnessComp.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.05);
  }

  setBand(band: Band, db: number) {
    this.buildGraph();
    const v = clamp(db, -18, 18);
    const node = band === 'low' ? this.low : band === 'mid' ? this.mid : this.high;
    node.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
    if (band === 'low') {
      this.lowDb = v;
      this.updateLoudnessComp();
    }
  }

  setBass(db: number) {
    this.buildGraph();
    this.bassDb = clamp(db, -18, 18);
    this.bass.gain.setTargetAtTime(this.bassDb, this.ctx.currentTime, 0.02);
    this.updateLoudnessComp();
  }

  setReverb(amount: number) {
    this.buildGraph();
    const wet = clamp(amount, 0, 1) * 0.45;
    this.wetReverb.gain.setTargetAtTime(wet, this.ctx.currentTime, 0.03);
    this.dryReverb.gain.setTargetAtTime(1 - wet * 0.15, this.ctx.currentTime, 0.03);
  }

  setEcho(amount: number) {
    this.buildGraph();
    const wet = clamp(amount, 0, 1);
    this.wetEcho.gain.setTargetAtTime(wet * 0.26, this.ctx.currentTime, 0.03);
    this.dryEcho.gain.setTargetAtTime(1 - wet * 0.08, this.ctx.currentTime, 0.03);
    // Keep only one restrained repeat: a low feedback gain prevents the delay
    // line from turning into a second, slowly repeating copy of the song.
    this.feedback.gain.setTargetAtTime(0.03 + wet * 0.12, this.ctx.currentTime, 0.03);
  }

  /**
   * Surround: blend in an HRTF-panned copy of the mix whose source orbits the
   * listener, creating the impression of the song circling around the head.
   * The orbit speed can be scaled (0 = off, 1 = normal ~9s/revolution).
   */
  setSurround(amount: number) {
    this.buildGraph();
    const a = clamp(amount, 0, 1);
    this.surroundRate = a;
    const t = this.ctx.currentTime;
    // Keep the orbiting copy clearly below the original. A wet gain above the
    // dry signal makes the same song sound like two tracks playing at once.
    this.surroundWet.gain.setTargetAtTime(a * 0.42, t, 0.06);
    this.surroundDry.gain.setTargetAtTime(1 - a * 0.12, t, 0.06);
    const speed = a > 0 ? 0.11 * (0.7 + a * 0.3) : 0;
    this.surroundOscX.frequency.setTargetAtTime(speed || 0.0001, t, 0.08);
    this.surroundOscZ.frequency.setTargetAtTime(speed || 0.0001, t, 0.08);
  }

  setVocalRemoval(enabled: boolean) {
    this.buildGraph();
    this.vocalDry.gain.setTargetAtTime(enabled ? 0 : 1, this.ctx.currentTime, 0.03);
    this.vocalWet.gain.setTargetAtTime(enabled ? 1 : 0, this.ctx.currentTime, 0.03);
  }

  setLimiter(enabled: boolean) {
    this.buildGraph();
    this.compressor.ratio.setTargetAtTime(enabled ? 3 : 1, this.ctx.currentTime, 0.03);
    this.compressor.threshold.setTargetAtTime(enabled ? -6 : 0, this.ctx.currentTime, 0.03);
    this.compressor.knee.setTargetAtTime(enabled ? 24 : 30, this.ctx.currentTime, 0.03);
    this.compressor.attack.setTargetAtTime(enabled ? 0.02 : 0.003, this.ctx.currentTime, 0.03);
    this.compressor.release.setTargetAtTime(enabled ? 0.4 : 0.25, this.ctx.currentTime, 0.03);
  }

  // ---- DJ effects ---------------------------------------------------------

  /**
   * Scratch: a short, rhythmic push-pull of the platter. Pitch follows speed
   * (preservesPitch off) so it sounds like a real turntable instead of the
   * artefacts produced by time-stretching.
   */
  setScratch(on: boolean) {
    if (on === this.scratchOn) return;
    this.scratchOn = on;
    if (on) {
      if (this.brakeOn) this.setVinylBrake(false);
      this.setTurntablePitch(true);
      this.scratchStart = performance.now();
      const tick = () => {
        if (!this.scratchOn) return;
        // ~0.9s gesture: quick back-spin -> forward push -> ease back to 1x
        const phase = ((performance.now() - this.scratchStart) / 900) % 1;
        let offset: number;
        if (phase < 0.18) {
          offset = -0.26 * this.easeInOutSine(phase / 0.18);
        } else if (phase < 0.62) {
          offset = -0.26 + 0.48 * this.easeInOutCubic((phase - 0.18) / 0.44);
        } else {
          offset = 0.22 * (1 - this.easeInOutSine((phase - 0.62) / 0.38));
        }
        this.applyPlaybackRate(this.baseSpeed * (1 + offset));
        this.scratchFrame = requestAnimationFrame(tick);
      };
      this.scratchFrame = requestAnimationFrame(tick);
    } else {
      if (this.scratchFrame) cancelAnimationFrame(this.scratchFrame);
      this.scratchFrame = 0;
      this.setTurntablePitch(false);
      this.applyPlaybackRate(this.baseSpeed);
    }
  }

  /** Vinyl brake: smoothly slow the platter down, with pitch following speed. */
  setVinylBrake(on: boolean) {
    if (on === this.brakeOn) return;
    this.brakeOn = on;
    if (on) {
      if (this.scratchOn) this.setScratch(false);
      this.setTurntablePitch(true);
      this.brakeStarted = performance.now();
      this.applyPlaybackRate(this.baseSpeed);
      const tick = () => {
        if (!this.brakeOn) return;
        const elapsed = (performance.now() - this.brakeStarted) / 1000;
        const progress = Math.min(1, elapsed / 1.6);
        const rate = this.baseSpeed * (0.08 + 0.92 * (1 - this.easeInOutSine(progress)));
        this.applyPlaybackRate(rate);
        if (progress < 1) this.brakeFrame = requestAnimationFrame(tick);
      };
      this.brakeFrame = requestAnimationFrame(tick);
    } else {
      if (this.brakeFrame) cancelAnimationFrame(this.brakeFrame);
      this.brakeFrame = 0;
      this.setTurntablePitch(false);
      this.applyPlaybackRate(this.baseSpeed);
    }
  }

  /** Filter sweep: log sweep the low-pass cutoff up and down while held. */
  setFilterSweep(on: boolean) {
    this.buildGraph();
    if (on === this.sweepOn) return;
    this.sweepOn = on;
    if (on) {
      this.sweepPhase = -Math.PI / 2;
      this.sweepTimer = window.setInterval(() => {
        this.sweepPhase += 0.075;
        const t = (Math.sin(this.sweepPhase) + 1) / 2;
        const freq = 140 * Math.pow(20000 / 140, t);
        this.sweepFilter.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.015);
      }, 35);
    } else {
      if (this.sweepTimer) window.clearInterval(this.sweepTimer);
      this.sweepTimer = 0;
      this.sweepFilter.frequency.setTargetAtTime(20000, this.ctx.currentTime, 0.04);
    }
  }

  setSiren(on: boolean) {
    this.buildGraph();
    this.sirenGain.gain.setTargetAtTime(on ? 0.09 : 0, this.ctx.currentTime, on ? 0.03 : 0.06);
  }

  setNoise(on: boolean) {
    this.buildGraph();
    this.noiseGain.gain.setTargetAtTime(on ? 0.16 : 0, this.ctx.currentTime, on ? 0.02 : 0.05);
  }

  setBeatRepeat(on: boolean) {
    this.buildGraph();
    this.repeatWet.gain.setTargetAtTime(on ? 0.5 : 0, this.ctx.currentTime, 0.03);
    this.repeatFeedback.gain.setTargetAtTime(on ? 0.58 : 0, this.ctx.currentTime, 0.03);
  }

  setFlanger(on: boolean) {
    this.buildGraph();
    this.flangerWet.gain.setTargetAtTime(on ? 0.55 : 0, this.ctx.currentTime, 0.04);
    this.flangerDry.gain.setTargetAtTime(on ? 0.85 : 1, this.ctx.currentTime, 0.04);
  }

  setPhaser(on: boolean) {
    this.buildGraph();
    this.phaserWet.gain.setTargetAtTime(on ? 0.6 : 0, this.ctx.currentTime, 0.04);
    this.phaserDry.gain.setTargetAtTime(on ? 0.85 : 1, this.ctx.currentTime, 0.04);
  }

  setCrusher(on: boolean) {
    this.buildGraph();
    this.crusherWet.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.03);
    this.crusherDry.gain.setTargetAtTime(on ? 0 : 1, this.ctx.currentTime, 0.03);
  }

  /** Stop timed motion effects (used on track change and window blur). */
  stopMotionEffects() {
    if (this.scratchOn) { this.scratchOn = false; if (this.scratchFrame) cancelAnimationFrame(this.scratchFrame); this.scratchFrame = 0; }
    if (this.brakeOn) { this.brakeOn = false; if (this.brakeFrame) cancelAnimationFrame(this.brakeFrame); this.brakeFrame = 0; }
    this.setTurntablePitch(false);
    if (this.sweepOn) {
      this.sweepOn = false;
      if (this.sweepTimer) window.clearInterval(this.sweepTimer);
      this.sweepTimer = 0;
      if (this.graphReady) this.sweepFilter.frequency.setTargetAtTime(20000, this.ctx.currentTime, 0.04);
    }
    this.applyPlaybackRate(this.baseSpeed);
  }

  analyser() {
    this.buildGraph(); return this.analyserNode; }

  frequencyData(): Uint8Array {
    this.buildGraph();
    if (!this.graphReady) return new Uint8Array(0);
    const data = new Uint8Array(this.analyserNode.frequencyBinCount);
    this.analyserNode.getByteFrequencyData(data);
    return data;
  }
}
