// All sound is synthesised in the browser: a dark ambient score and positional footsteps.
// Browsers only allow audio after a click, so the context starts on the first pointer press.

import { repeatMailChime } from "./mail-chime";

let context: AudioContext | null = null;
let master: GainNode | null = null;
let effectsMix: GainNode | null = null;
let reverb: ConvolverNode | null = null;
let muted = false;
let volume: number | undefined;
let scoreStarted = false;
let footstepNoise: AudioBuffer | undefined;
const listeners = new Set<(muted: boolean) => void>();

const MUTE_KEY = "reader-sound-muted";
const VOLUME_KEY = "reader-sound-volume";

function readMuted() {
  try { return localStorage.getItem(MUTE_KEY) === "1"; } catch { return false; }
}

// A long, dark tail built from decaying noise; it gives every note the feel of an empty building.
function makeReverb(ctx: AudioContext, seconds = 4.5) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3);
  }
  const node = ctx.createConvolver();
  node.buffer = impulse;
  return node;
}

function noiseBuffer(ctx: AudioContext, seconds: number, brown = false) {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    last = brown ? (last + 0.02 * white) / 1.02 : white;
    data[i] = brown ? last * 3.5 : white;
  }
  return buffer;
}

function ensureContext() {
  if (context) return context;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  context = new Ctor();
  master = context.createGain();
  master.gain.value = muted ? 0 : getAudioVolume() / 100;
  master.connect(context.destination);
  effectsMix = context.createGain();
  effectsMix.connect(master);
  reverb = makeReverb(context);
  const wet = context.createGain();
  wet.gain.value = 0.55;
  reverb.connect(wet).connect(effectsMix);
  return context;
}

// ---- Score ---------------------------------------------------------------------------------

function startScore(ctx: AudioContext) {
  if (scoreStarted || !effectsMix || !reverb) return;
  scoreStarted = true;
  const score = ctx.createGain();
  score.gain.value = 0;
  score.gain.linearRampToValueAtTime(0.9, ctx.currentTime + 3); // fade in
  score.connect(effectsMix);

  // Drone: two low, slightly detuned tones under a slowly breathing low-pass filter.
  const droneFilter = ctx.createBiquadFilter();
  droneFilter.type = "lowpass";
  droneFilter.frequency.value = 700;
  const breath = ctx.createOscillator();
  const breathDepth = ctx.createGain();
  breath.frequency.value = 0.05;
  breathDepth.gain.value = 300;
  breath.connect(breathDepth).connect(droneFilter.frequency);
  breath.start();
  const droneGain = ctx.createGain();
  droneGain.gain.value = 0.22;
  droneFilter.connect(droneGain).connect(score);
  // Pitched high enough for laptop speakers: A2, E3 and A3 with a slight beat between them.
  for (const [freq, type, detune] of [[110, "sawtooth", -7], [164.8, "triangle", 6], [220, "sawtooth", 4]] as const) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    osc.detune.value = detune;
    osc.connect(droneFilter);
    osc.start();
  }

  // Tape hiss and room tone.
  const hiss = ctx.createBufferSource();
  hiss.buffer = noiseBuffer(ctx, 4);
  hiss.loop = true;
  const hissFilter = ctx.createBiquadFilter();
  hissFilter.type = "bandpass";
  hissFilter.frequency.value = 3000;
  hissFilter.Q.value = 0.7;
  const hissGain = ctx.createGain();
  hissGain.gain.value = 0.035;
  hiss.connect(hissFilter).connect(hissGain).connect(score);
  hiss.start();

  // Sparse piano-like notes from A minor with a flattened second, falling into the reverb.
  const notes = [220, 233.1, 261.6, 293.7, 329.6, 349.2, 440, 523.3];
  const pianoBus = ctx.createGain();
  pianoBus.gain.value = 0.45;
  pianoBus.connect(score);
  pianoBus.connect(reverb);
  const playNote = (when: number, freq: number, level: number) => {
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(level, when + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0008, when + 3.8);
    env.connect(pianoBus);
    // Uncanny touch: each note slowly drifts off pitch, like a warped tape.
    const drift = (Math.random() - 0.5) * 70;
    for (const [ratio, amp] of [[1, 1], [2, 0.35], [3, 0.12]]) {
      const osc = ctx.createOscillator();
      const partial = ctx.createGain();
      osc.frequency.value = freq * ratio;
      osc.detune.setValueAtTime(0, when);
      osc.detune.linearRampToValueAtTime(drift, when + 3.5);
      partial.gain.value = amp;
      osc.connect(partial).connect(env);
      osc.start(when);
      osc.stop(when + 4);
    }
  };
  const phrase = () => {
    const now = ctx.currentTime + 0.1;
    const count = 1 + Math.floor(Math.random() * 3);
    let at = now;
    for (let i = 0; i < count; i++) {
      const freq = notes[Math.floor(Math.random() * notes.length)];
      playNote(at, freq, 0.5 + Math.random() * 0.4);
      // Now and then a quiet tritone sounds against it, just wrong enough to unsettle.
      if (Math.random() < 0.25) playNote(at + 0.04, freq * Math.SQRT2, 0.18);
      at += 0.6 + Math.random() * 1.2;
    }
    window.setTimeout(phrase, 5000 + Math.random() * 6000);
  };
  window.setTimeout(phrase, 1500);

  // A distant, breath-like swell of filtered noise that comes and goes.
  const breathSource = ctx.createBufferSource();
  breathSource.buffer = noiseBuffer(ctx, 3);
  breathSource.loop = true;
  const breathFilter = ctx.createBiquadFilter();
  breathFilter.type = "bandpass";
  breathFilter.frequency.value = 2400;
  breathFilter.Q.value = 6;
  const breathGain = ctx.createGain();
  breathGain.gain.value = 0;
  breathSource.connect(breathFilter).connect(breathGain).connect(reverb);
  breathSource.start();
  const sigh = () => {
    const t = ctx.currentTime;
    breathFilter.frequency.setValueAtTime(1800 + Math.random() * 1600, t);
    breathGain.gain.setTargetAtTime(0.05, t, 1.2);
    breathGain.gain.setTargetAtTime(0, t + 2.5, 1.5);
    window.setTimeout(sigh, 18000 + Math.random() * 16000);
  };
  window.setTimeout(sigh, 12000);
}

// ---- Public API ----------------------------------------------------------------------------

export function initAudio() {
  if (typeof window === "undefined") return;
  muted = readMuted();
  listeners.forEach(listener => listener(muted));
  // Every click or key press wakes the audio again, in case the browser suspended it.
  const start = () => {
    const ctx = ensureContext();
    if (!ctx) return;
    if (ctx.state !== "running") void ctx.resume();
    startScore(ctx);
  };
  window.addEventListener("pointerdown", start);
  window.addEventListener("keydown", start);
  return () => {
    window.removeEventListener("pointerdown", start);
    window.removeEventListener("keydown", start);
  };
}

export function isMuted() { return muted; }

export function getAudioVolume() {
  if (volume !== undefined) return volume;
  try {
    const saved = localStorage.getItem(VOLUME_KEY);
    const level = saved === null ? 100 : Number(saved);
    volume = Number.isFinite(level) ? Math.max(0, Math.min(100, level)) : 100;
  } catch {
    return 100;
  }
  return volume;
}

function updateOutputLevel() {
  const level = muted ? 0 : getAudioVolume() / 100;
  if (context && master) master.gain.setTargetAtTime(level, context.currentTime, 0.04);
  if (level === 0 && "speechSynthesis" in window) window.speechSynthesis.cancel();
}

export function setAudioVolume(next: number) {
  if (!Number.isFinite(next)) return;
  volume = Math.max(0, Math.min(100, next));
  try { localStorage.setItem(VOLUME_KEY, String(volume)); } catch { /* storage unavailable */ }
  updateOutputLevel();
}

export function playRefusalAlarm() {
  const ctx = ensureContext();
  if (!ctx || !master || !effectsMix) return;
  const mix = effectsMix;
  void ctx.resume().catch(() => {});

  const siren = ctx.createOscillator();
  const sweep = ctx.createOscillator();
  const depth = ctx.createGain();
  const level = ctx.createGain();
  siren.type = "triangle";
  siren.frequency.value = 1120;
  sweep.type = "triangle";
  sweep.frequency.value = 2.25;
  depth.gain.value = 280;
  level.gain.setValueAtTime(0, ctx.currentTime);
  level.gain.setTargetAtTime(0.29, ctx.currentTime, 0.015);
  mix.gain.setTargetAtTime(0.13, ctx.currentTime, 0.025);
  sweep.connect(depth).connect(siren.frequency);
  siren.connect(level).connect(master);
  siren.start();
  sweep.start();
  return () => {
    const end = ctx.currentTime + 0.06;
    level.gain.setTargetAtTime(0, ctx.currentTime, 0.012);
    mix.gain.setTargetAtTime(1, end, 0.09);
    siren.stop(end);
    sweep.stop(end);
    siren.onended = () => {
      sweep.disconnect();
      depth.disconnect();
      siren.disconnect();
      level.disconnect();
    };
  };
}

export function playMailArrival(delayMs: number) {
  try {
    const ctx = ensureContext();
    if (!ctx || !effectsMix) return;
    void ctx.resume().catch(() => {});
    return repeatMailChime(ctx, effectsMix, delayMs);
  } catch {
    // The visual alert still works when audio is unavailable.
  }
}

export function setMuted(next: boolean) {
  muted = next;
  try { localStorage.setItem(MUTE_KEY, next ? "1" : "0"); } catch { /* storage unavailable */ }
  updateOutputLevel();
  listeners.forEach(listener => listener(next));
}

export function onMutedChange(listener: (muted: boolean) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

// The paperclip's spoken voice: the system's Chinese speech, pitched down a little.
const preferredVoices = ["Reed", "Eddy", "Rocko", "Li-Mu", "Yu-shu"];
function chineseVoice() {
  const voices = window.speechSynthesis.getVoices().filter(voice => /^zh[-_](CN|Hans)/i.test(voice.lang));
  return preferredVoices.map(name => voices.find(voice => voice.name.startsWith(name))).find(Boolean) ?? voices[0];
}

export function speakLine(text: string) {
  if (muted || typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const level = getAudioVolume();
  if (level === 0) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "zh-CN";
  const voice = chineseVoice();
  if (voice) utterance.voice = voice;
  utterance.rate = 0.92;
  utterance.pitch = 0.7;
  utterance.volume = 0.9 * level / 100;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

// One typewriter key strike: a bright click on top of a soft wooden thunk.
export function playTypeKey() {
  if (!context || !effectsMix || muted || context.state !== "running") return;
  const ctx = context;
  const when = ctx.currentTime;
  const click = ctx.createBufferSource();
  click.buffer = noiseBuffer(ctx, 0.03);
  const clickFilter = ctx.createBiquadFilter();
  clickFilter.type = "bandpass";
  clickFilter.frequency.value = 2600 + Math.random() * 900;
  clickFilter.Q.value = 2;
  const clickGain = ctx.createGain();
  clickGain.gain.setValueAtTime(0.18 + Math.random() * 0.06, when);
  clickGain.gain.exponentialRampToValueAtTime(0.001, when + 0.03);
  click.connect(clickFilter).connect(clickGain).connect(effectsMix);
  click.start(when);
  const thunk = ctx.createOscillator();
  thunk.frequency.setValueAtTime(140, when);
  thunk.frequency.exponentialRampToValueAtTime(70, when + 0.05);
  const thunkGain = ctx.createGain();
  thunkGain.gain.setValueAtTime(0.06, when);
  thunkGain.gain.exponentialRampToValueAtTime(0.001, when + 0.06);
  thunk.connect(thunkGain).connect(effectsMix);
  thunk.start(when);
  thunk.stop(when + 0.07);
}

// One footfall. `pan` is -1 (left) to 1 (right); `level` grows as the walker nears the camera.
export function playFootstep({ pan, level, heavy }: { pan: number; level: number; heavy: boolean }) {
  if (!context || !effectsMix || muted || getAudioVolume() === 0 || context.state !== "running") return;
  const ctx = context;
  const when = ctx.currentTime;
  const duration = heavy ? 0.16 : 0.105;
  const peak = Math.min(0.64, level * (heavy ? 2.8 : 2.3));
  const source = ctx.createBufferSource();
  source.buffer = footstepNoise ??= noiseBuffer(ctx, 0.17);
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = (heavy ? 380 : 880) * (0.9 + Math.random() * 0.2);
  filter.Q.value = 0.8;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.001, when);
  env.gain.linearRampToValueAtTime(peak, when + 0.008);
  env.gain.exponentialRampToValueAtTime(0.001, when + duration);
  const panner = ctx.createStereoPanner();
  panner.pan.value = Math.max(-1, Math.min(1, pan));
  source.connect(filter).connect(env).connect(panner).connect(effectsMix);

  const heel = ctx.createOscillator();
  heel.frequency.setValueAtTime(heavy ? 115 : 175, when);
  heel.frequency.exponentialRampToValueAtTime(heavy ? 59 : 95, when + 0.06);
  const heelGain = ctx.createGain();
  heelGain.gain.setValueAtTime(0.001, when);
  heelGain.gain.linearRampToValueAtTime(peak * (heavy ? 0.4 : 0.19), when + 0.006);
  heelGain.gain.exponentialRampToValueAtTime(0.001, when + duration);
  heel.connect(heelGain).connect(panner);

  let send: GainNode | undefined;
  if (reverb) {
    send = ctx.createGain();
    send.gain.value = 0.1;
    panner.connect(send).connect(reverb);
  }
  source.onended = () => {
    source.disconnect();
    filter.disconnect();
    env.disconnect();
    heel.disconnect();
    heelGain.disconnect();
    panner.disconnect();
    send?.disconnect();
  };
  source.start(when);
  heel.start(when);
  heel.stop(when + duration);
}
