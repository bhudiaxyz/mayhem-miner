/**
 * Audio — tiny WebAudio synth: chiptune effects and a procedural soundtrack. No audio files.
 *
 * Purpose
 *   Gives every game event a sound and the caverns a tune, in the spirit of 8- and 16-bit
 *   home-computer music: square and triangle voices, a noise channel, short envelopes.
 *
 * Operations
 *   - unlock(): creates the AudioContext (master → sfx and music buses), the shared 1 s noise
 *     buffer, and starts the music scheduler; or resumes a suspended context.
 *   - tone() / noise(): an oscillator with pitch glide and exponential decay; a noise slice
 *     through a low-pass that sweeps down.
 *   - sfx: one entry per GameEvent, plus UI ticks.
 *   - Music: a look-ahead scheduler (every 25 ms, 0.12 s ahead on the audio clock) plays an
 *     original 8-bar loop in A minor: a pulse lead from MELODY (scale degrees, 0 = rest), a
 *     triangle bass on the root of each bar's chord (Am F C G Am F E E), and noise hats.
 *     setMusicIntensity(0..1) raises the tempo from 120 to 168 BPM; main.ts drives it from
 *     how little air is left.
 *   - toggleMute() / isMuted(): master on / off, persisted in localStorage 'mm-muted'.
 *   - suspendAudio(): called while paused / in menus with nothing moving.
 *
 * Usage
 *   main.ts: unlock() from a user gesture, sfx[event]() from Game.onEvent.
 *
 * Highlights
 *   - Before unlock() every call is a silent no-op (browsers block audio until a gesture).
 *   - Timing uses the audio clock, so the beat stays steady when frames hitch.
 *
 * See also: main.ts (event routing), core/game.ts (GameEvent); DESIGN.md "14. Audio".
 */
export const sfx = {
    jump: () => tone(380, 0.16, "square", 0.05, 760),
    land: () => noise(0.05, 0.08, 900),
    crystal: () => [1318, 1760].forEach((f, i) => tone(f, 0.09, "square", 0.05, f, now() + i * 0.05)),
    open: () => [988, 1318, 1568, 1976].forEach((f, i) => tone(f, 0.12, "square", 0.06, f, now() + i * 0.07)),
    lever: () => (tone(160, 0.12, "square", 0.08, 90), noise(0.1, 0.1, 2400)),
    crumble: () => noise(0.18, 0.12, 1600),
    die: () => tone(880, 0.9, "sawtooth", 0.09, 60),
    complete: () => [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.16, "triangle", 0.12, f, now() + i * 0.09)),
    bonus: () => tone(1800 + Math.random() * 400, 0.025, "square", 0.025),
    extra: () => [784, 1046, 1318, 1568].forEach((f, i) => tone(f, 0.1, "square", 0.06, f, now() + i * 0.08)),
    over: () => [392, 330, 262, 196].forEach((f, i) => tone(f, 0.4, "triangle", 0.12, f, now() + i * 0.3)),
    uiMove: () => tone(1320, 0.035, "sine", 0.035, 1500),
    uiSelect: () => tone(660, 0.09, "triangle", 0.07, 1320),
};

// A natural minor from A3 (MIDI 57). Degrees 1..14 index SCALE; 0 is a rest.
const SCALE = [0, 57, 59, 60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79];
const BASS = [45, 41, 48, 43, 45, 41, 40, 40]; // Am F C G Am F E E
// 8 bars × 8 eighth notes, written for this project.
const MELODY = [
    8, 0, 10, 8, 12, 0, 10, 8, 6, 0, 8, 6, 10, 8, 6, 0, 5, 0, 7, 5, 10, 0, 8, 7, 5, 7, 8, 10, 12, 10, 8, 7, 8, 0, 10, 8,
    12, 0, 13, 12, 10, 0, 12, 10, 8, 6, 5, 0, 7, 0, 5, 7, 9, 0, 7, 5, 7, 9, 11, 12, 11, 9, 7, 0,
];

let ctx: AudioContext | null = null;
let master: GainNode;
let sfxBus: GainNode;
let musicBus: GainNode;
let noiseBuf: AudioBuffer;
let muted = localStorage.getItem("mm-muted") === "1";
let intensity = 0;
let nextNote = 0;
let step = 0;

export function unlock() {
    if (ctx) return void ctx.resume();
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.6;
    master.connect(ctx.destination);
    sfxBus = ctx.createGain();
    musicBus = ctx.createGain();
    musicBus.gain.value = 0.35;
    sfxBus.connect(master);
    musicBus.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    nextNote = ctx.currentTime + 0.1;
    setInterval(schedule, 25);
}

export function toggleMute() {
    muted = !muted;
    localStorage.setItem("mm-muted", muted ? "1" : "0");
    if (ctx) master.gain.value = muted ? 0 : 0.6;
    return muted;
}

export const isMuted = () => muted;

export function suspendAudio() {
    if (ctx?.state === "running") void ctx.suspend();
}

/** 0 = calm, 1 = nearly out of air. */
export function setMusicIntensity(v: number) {
    intensity += (Math.min(1, Math.max(0, v)) - intensity) * 0.05;
}

const now = () => ctx?.currentTime ?? 0;
const midi = (m: number) => 440 * 2 ** ((m - 69) / 12);

function tone(freq: number, dur: number, type: OscillatorType, vol: number, to = freq, at = 0, bus = sfxBus) {
    if (!ctx) return;
    const t = at || ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(t + dur);
}

function noise(dur: number, vol: number, cutoff: number, at = 0, bus = sfxBus) {
    if (!ctx) return;
    const t = at || ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(cutoff, t);
    lp.frequency.exponentialRampToValueAtTime(60, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(lp).connect(g).connect(bus);
    src.start(t, Math.random() * 0.8);
    src.stop(t + dur);
}

function schedule() {
    if (!ctx || ctx.state !== "running" || muted) return;
    const eighth = 60 / (120 + 48 * intensity) / 2;
    while (nextNote < ctx.currentTime + 0.12) {
        const i = step % MELODY.length;
        const bar = Math.floor(i / 8);
        const deg = MELODY[i];
        if (deg) tone(midi(SCALE[deg] + 12), eighth * 0.9, "square", 0.05, midi(SCALE[deg] + 12), nextNote, musicBus);
        if (i % 2 === 0) tone(midi(BASS[bar]), eighth * 1.8, "triangle", 0.12, midi(BASS[bar]), nextNote, musicBus);
        if (i % 2 === 1) noise(0.03, 0.04 + 0.04 * intensity, 8000, nextNote, musicBus);
        nextNote += eighth;
        step++;
    }
}
