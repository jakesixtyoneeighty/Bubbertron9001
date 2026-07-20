/**
 * Tiny synthesized sound engine (Web Audio API).
 * No audio assets needed - every effect is generated with oscillators,
 * so it works offline and adds zero bundle weight.
 */

export type SoundName =
  | "send"
  | "receive"
  | "tool"
  | "toolDone"
  | "error"
  | "click"
  | "hover"
  | "connect";

const MUTE_STORAGE_KEY = "bubbertron9001-muted";
const PREVIOUS_MUTE_STORAGE_KEY = "bubberton9001-muted";

let ctx: AudioContext | null = null;
let muted = false;
let lastHoverAt = 0;

try {
  const stored =
    localStorage.getItem(MUTE_STORAGE_KEY) ??
    localStorage.getItem(PREVIOUS_MUTE_STORAGE_KEY);
  muted = stored === "true";
  if (stored !== null) {
    localStorage.setItem(MUTE_STORAGE_KEY, stored);
  }
  localStorage.removeItem(PREVIOUS_MUTE_STORAGE_KEY);
} catch {
  // localStorage unavailable; default to sound on
}

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === "suspended") {
    void ctx.resume();
  }
  return ctx;
}

interface ToneOptions {
  frequency: number;
  /** End frequency for pitch sweeps */
  glideTo?: number;
  type?: OscillatorType;
  duration?: number;
  volume?: number;
  delay?: number;
}

function tone(audio: AudioContext, opts: ToneOptions): void {
  const {
    frequency,
    glideTo,
    type = "sine",
    duration = 0.12,
    volume = 0.08,
    delay = 0,
  } = opts;

  const start = audio.currentTime + delay;
  const osc = audio.createOscillator();
  const gain = audio.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(frequency, start);
  if (glideTo !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(glideTo, 1), start + duration);
  }

  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(volume, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  osc.connect(gain);
  gain.connect(audio.destination);
  osc.start(start);
  osc.stop(start + duration + 0.05);
}

const players: Record<SoundName, (audio: AudioContext) => void> = {
  // Message sent: quick upward zip
  send: (audio) => {
    tone(audio, { frequency: 420, glideTo: 880, type: "triangle", duration: 0.14, volume: 0.09 });
    tone(audio, { frequency: 840, glideTo: 1760, type: "sine", duration: 0.1, volume: 0.04, delay: 0.02 });
  },
  // Response finished: cheerful two-note chime
  receive: (audio) => {
    tone(audio, { frequency: 660, type: "sine", duration: 0.14, volume: 0.07 });
    tone(audio, { frequency: 990, type: "sine", duration: 0.22, volume: 0.07, delay: 0.11 });
  },
  // Tool starts running: soft techy blip
  tool: (audio) => {
    tone(audio, { frequency: 520, glideTo: 640, type: "square", duration: 0.06, volume: 0.025 });
  },
  // Tool finished: satisfying tick up
  toolDone: (audio) => {
    tone(audio, { frequency: 780, glideTo: 1040, type: "triangle", duration: 0.08, volume: 0.035 });
  },
  // Error: gentle descending buzz (not scary)
  error: (audio) => {
    tone(audio, { frequency: 330, glideTo: 190, type: "sawtooth", duration: 0.28, volume: 0.05 });
  },
  // Generic UI click (chips, suggestions)
  click: (audio) => {
    tone(audio, { frequency: 700, glideTo: 900, type: "triangle", duration: 0.05, volume: 0.04 });
  },
  // Barely-there hover tick
  hover: (audio) => {
    tone(audio, { frequency: 1150, type: "sine", duration: 0.03, volume: 0.012 });
  },
  // Studio connected: little power-up arpeggio
  connect: (audio) => {
    tone(audio, { frequency: 523, type: "triangle", duration: 0.1, volume: 0.06 });
    tone(audio, { frequency: 659, type: "triangle", duration: 0.1, volume: 0.06, delay: 0.09 });
    tone(audio, { frequency: 784, type: "triangle", duration: 0.1, volume: 0.06, delay: 0.18 });
    tone(audio, { frequency: 1046, type: "triangle", duration: 0.2, volume: 0.07, delay: 0.27 });
  },
};

export function playSound(name: SoundName): void {
  if (muted) return;
  // Throttle hover sounds so rapid mouse movement doesn't spam
  if (name === "hover") {
    const now = Date.now();
    if (now - lastHoverAt < 90) return;
    lastHoverAt = now;
  }
  const audio = getContext();
  if (!audio) return;
  try {
    players[name](audio);
  } catch {
    // Audio failures should never break the UI
  }
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(value: boolean): void {
  muted = value;
  try {
    localStorage.setItem(MUTE_STORAGE_KEY, String(value));
  } catch {
    // Persisting the preference is best-effort
  }
}

export function toggleMuted(): boolean {
  setMuted(!muted);
  return muted;
}
