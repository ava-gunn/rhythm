// Audio playback. Each rhythm cycle is synthesised into an AudioBuffer and
// played with loop = true, so timing is sample-accurate, loops are gapless and
// nothing depends on JS timers (which mobile browsers throttle).

export const SOUNDS = [
  { id: 'clave', label: 'Clave' },
  { id: 'wood', label: 'Woodblock' },
  { id: 'drum', label: 'Drum' },
  { id: 'beep', label: 'Beep' },
];

const SETTINGS_KEY = 'good-rhythms.audio';
const DEFAULTS = { bpm: 100, sound: 'clave', metronome: true };
export const BPM_MIN = 40;
export const BPM_MAX = 220;

/**
 * Pulses per beat used for the tempo and the metronome: 16-pulse rhythms are
 * felt in sixteenths (4 per beat), 12-pulse ones in triplets (3 per beat).
 */
export function pulsesPerBeat(n) {
  if (n % 4 === 0 && n % 3 !== 0) return 4;
  if (n % 3 === 0) return 3;
  return 2;
}

export const rhythmKey = (r) => `${r.n}:${r.onsets.join('.')}`;

export class Player extends EventTarget {
  constructor() {
    super();
    this.ctx = null;
    this.master = null;
    this.source = null;
    this.current = null; // { onsets, n, title, subtitle, href }
    this.playing = false;
    this.t0 = 0; // context time at which the current loop's phase was 0
    this.cycle = 1; // seconds per cycle
    this.settings = { ...DEFAULTS, ...readSettings() };
  }

  get key() {
    return this.current ? rhythmKey(this.current) : null;
  }

  isPlaying(rhythm) {
    return this.playing && this.current && rhythmKey(rhythm) === this.key;
  }

  /** Must be called from a user gesture the first time (iOS/Safari). */
  async unlock() {
    if (!this.ctx) {
      // Play through the iOS silent switch, like a music app (Safari 17+).
      try {
        if (navigator.audioSession) navigator.audioSession.type = 'playback';
      } catch {
        /* not supported */
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC({ latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);
      this.ctx.addEventListener('statechange', () => {
        if (this.ctx.state !== 'running' && this.playing) this.emit();
      });
      // iOS suspends ("interrupts") audio in the background or during calls;
      // try to resume when the app returns and on the next tap.
      const revive = () => {
        if (this.playing && this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
      };
      document.addEventListener('visibilitychange', () => !document.hidden && revive());
      document.addEventListener('pointerdown', revive, { capture: true });
    }
    if (this.ctx.state !== 'running') {
      try {
        await this.ctx.resume();
      } catch {
        /* ignored: will retry on next gesture */
      }
    }
  }

  async toggle(rhythm) {
    if (this.isPlaying(rhythm)) this.stop();
    else await this.play(rhythm);
  }

  async play(rhythm) {
    await this.unlock();
    const switching = this.playing && this.current;
    this.current = { ...rhythm, onsets: [...rhythm.onsets] };
    // When switching rhythms, keep the beat going: restart at a phase that
    // lines up with the old rhythm's pulse grid.
    this.restart(switching ? 'pulse' : 'zero');
    this.playing = true;
    this.emit();
  }

  /** Load a rhythm into the player without starting it. */
  load(rhythm) {
    if (this.playing) return this.play(rhythm);
    this.current = { ...rhythm, onsets: [...rhythm.onsets] };
    this.emit();
  }

  stop() {
    if (this.source) {
      try {
        this.source.stop();
      } catch {
        /* already stopped */
      }
      this.source.disconnect();
      this.source = null;
    }
    this.playing = false;
    this.emit();
  }

  update(patch) {
    Object.assign(this.settings, patch);
    this.settings.bpm = Math.max(BPM_MIN, Math.min(BPM_MAX, Math.round(this.settings.bpm)));
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      /* private mode */
    }
    if (this.playing) this.restart('keep');
    this.emit();
  }

  /** Re-render the loop buffer and swap it in. `mode`: zero | keep | pulse */
  restart(mode) {
    const ctx = this.ctx;
    const { onsets, n } = this.current;
    const g = pulsesPerBeat(n);
    const pulseDur = 60 / (this.settings.bpm * g);
    const cycle = pulseDur * n;
    const buffer = renderLoop(ctx, onsets, n, pulseDur, g, this.settings);

    const when = ctx.currentTime + 0.03;
    let phase = 0;
    if (this.source && mode !== 'zero') {
      const old = (((when - this.t0) / this.cycle) % 1 + 1) % 1;
      if (mode === 'keep') phase = old;
      else {
        // Continue on the next pulse boundary of the old grid.
        const oldPulseDur = this.cycle / (this.oldN || n);
        const into = (when - this.t0) % oldPulseDur;
        const wait = into < 1e-4 ? 0 : oldPulseDur - into;
        return this.swap(buffer, when + wait, 0, cycle);
      }
    }
    this.swap(buffer, when, phase * cycle, cycle);
  }

  swap(buffer, when, offset, cycle) {
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.connect(this.master);
    src.start(when, offset);
    if (this.source) {
      try {
        this.source.stop(when);
      } catch {
        /* ignore */
      }
    }
    this.source = src;
    this.t0 = when - offset;
    this.cycle = cycle;
    this.oldN = this.current.n;
  }

  /** Playback position for visuals: { pulse, phase } or null. */
  position() {
    if (!this.playing || !this.ctx || !this.current) return null;
    const latency = Number.isFinite(this.ctx.outputLatency) ? this.ctx.outputLatency : this.ctx.baseLatency || 0;
    const t = this.ctx.currentTime - latency - this.t0;
    if (t < 0) return { pulse: -1, phase: 0 };
    const phase = (t / this.cycle) % 1;
    return { pulse: Math.floor(phase * this.current.n), phase };
  }

  emit() {
    this.dispatchEvent(new Event('change'));
  }
}

function readSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    const out = {};
    if (Number.isFinite(s.bpm)) out.bpm = s.bpm;
    if (SOUNDS.some((x) => x.id === s.sound)) out.sound = s.sound;
    if (typeof s.metronome === 'boolean') out.metronome = s.metronome;
    return out;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Synthesis. Everything is added into a circular buffer so the tails of the
// last notes wrap into the start and the loop is seamless.

function renderLoop(ctx, onsets, n, pulseDur, g, settings) {
  const sr = ctx.sampleRate;
  const length = Math.max(1, Math.round(n * pulseDur * sr));
  const data = new Float32Array(length);
  const voice = VOICES[settings.sound] || VOICES.clave;
  const onsetSet = new Set(onsets);
  for (let p = 0; p < n; p++) {
    const start = Math.round(p * pulseDur * sr);
    if (settings.metronome && p % g === 0) tick(data, start, sr, p === 0 ? 0.3 : 0.16);
    if (onsetSet.has(p)) voice(data, start, sr, p === 0 ? 1 : 0.8);
  }
  // Keep the peak below 0 dBFS.
  let peak = 0;
  for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(data[i]));
  if (peak > 0.95) {
    const s = 0.95 / peak;
    for (let i = 0; i < length; i++) data[i] *= s;
  }
  const buffer = ctx.createBuffer(1, length, sr);
  buffer.getChannelData(0).set(data);
  return buffer;
}

function addTone(data, start, sr, { dur, amp, freq, decay, attack = 0.001, partials = [[1, 1]], sweep = null }) {
  const len = data.length;
  const total = Math.min(Math.round(dur * sr), len);
  const phases = partials.map(() => 0);
  for (let i = 0; i < total; i++) {
    const t = i / sr;
    const env = (t < attack ? t / attack : 1) * Math.exp(-t / decay);
    const f = sweep ? sweep(t) : freq;
    let s = 0;
    for (let p = 0; p < partials.length; p++) {
      phases[p] += (2 * Math.PI * f * partials[p][0]) / sr;
      s += partials[p][1] * Math.sin(phases[p]);
    }
    data[(start + i) % len] += amp * env * s;
  }
}

// Deterministic noise so every render of a loop is identical.
function noise(seed) {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) / 4294967296) * 2 - 1;
  };
}

function addNoise(data, start, sr, { dur, amp, decay, hp = 0.85, seed = 7 }) {
  const len = data.length;
  const total = Math.min(Math.round(dur * sr), len);
  const rnd = noise(seed + start);
  let prevIn = 0,
    prevOut = 0;
  for (let i = 0; i < total; i++) {
    const t = i / sr;
    const inp = rnd();
    const out = hp * (prevOut + inp - prevIn); // one-pole high-pass
    prevIn = inp;
    prevOut = out;
    data[(start + i) % len] += amp * Math.exp(-t / decay) * out;
  }
}

function tick(data, start, sr, amp) {
  addNoise(data, start, sr, { dur: 0.05, amp, decay: 0.01, hp: 0.9 });
}

const VOICES = {
  clave(data, start, sr, a) {
    addTone(data, start, sr, { dur: 0.25, amp: 0.55 * a, freq: 2450, decay: 0.035, partials: [[1, 1], [2.02, 0.12]] });
    addNoise(data, start, sr, { dur: 0.01, amp: 0.25 * a, decay: 0.002 });
  },
  wood(data, start, sr, a) {
    addTone(data, start, sr, { dur: 0.3, amp: 0.6 * a, freq: 880, decay: 0.05, partials: [[1, 1], [1.58, 0.5], [2.9, 0.15]] });
    addNoise(data, start, sr, { dur: 0.008, amp: 0.2 * a, decay: 0.002 });
  },
  drum(data, start, sr, a) {
    addTone(data, start, sr, {
      dur: 0.5,
      amp: 0.85 * a,
      decay: 0.16,
      attack: 0.002,
      sweep: (t) => 170 + 160 * Math.exp(-t / 0.018),
      partials: [[1, 1], [1.5, 0.15]],
    });
    addNoise(data, start, sr, { dur: 0.02, amp: 0.15 * a, decay: 0.004 });
  },
  beep(data, start, sr, a) {
    addTone(data, start, sr, { dur: 0.25, amp: 0.4 * a, freq: 880, decay: 0.06, attack: 0.003, partials: [[1, 1], [2, 0.25], [3, 0.1]] });
  },
};
