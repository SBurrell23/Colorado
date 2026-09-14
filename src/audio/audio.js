// Every sound effect in the game is synthesised at runtime with the Web Audio
// API: the wooden clacks, the birdcalls and the wind under them are all
// oscillators, filtered noise and one generated impulse response standing in
// for the open air.
//
// The music is the one recording in the game. It streams through a media
// element rather than being decoded into a buffer -- ten megabytes of MP3
// becomes a couple of hundred megabytes of float samples, which is a silly
// price for something that only ever plays quietly in the background. If it
// will not load, the synthesised pad it replaced takes over, so the meadow is
// never silent.

// Resolved against this module rather than the page, so it survives being
// served from a subdirectory.
const MUSIC_URL = new URL('../../assets/music/pastoral-serenity.mp3', import.meta.url).href;
// The track is mastered loud and the game is not about the music, so it is
// trimmed well down before it ever reaches the player's own volume slider.
const MUSIC_TRIM = 0.34;
const MUSIC_FADE = 4;      // seconds, both in and out

const A4 = 440;
const NOTE = (semitonesFromA4) => A4 * Math.pow(2, semitonesFromA4 / 12);

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.master = null;
    this.sfxBus = null;
    this.musicBus = null;
    this.convolver = null;
    this.ambient = null;
    this.track = null;
    this.settings = { master: 0.8, sfx: 0.85, music: 0.45, muted: false };
    this.noiseBuffer = null;
  }

  /** Must be called from a user gesture (browsers block audio otherwise). */
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();

    this.master = this.ctx.createGain();
    this.master.gain.value = this.settings.muted ? 0 : this.settings.master;
    this.master.connect(this.ctx.destination);

    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = this.settings.sfx;
    this.sfxBus.connect(this.master);

    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = this.settings.music;
    this.musicBus.connect(this.master);

    // A short, open tail: a meadow with trees, not a cathedral.
    this.convolver = this.ctx.createConvolver();
    this.convolver.buffer = this.makeImpulse(2.6, 2.8);
    const wet = this.ctx.createGain();
    wet.gain.value = 0.26;
    this.convolver.connect(wet);
    wet.connect(this.master);

    this.noiseBuffer = this.makeNoise(2.0);
    this.ready = true;
    this.applySettings(this.settings);
  }

  makeImpulse(seconds, decay) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (1 - t * 0.3);
      }
    }
    return buf;
  }

  makeNoise(seconds) {
    const rate = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, Math.floor(rate * seconds), rate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  applySettings(s) {
    Object.assign(this.settings, s);
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.settings.muted ? 0 : this.settings.master, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(this.settings.sfx, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.settings.music, t, 0.05);
  }

  // -- primitives ---------------------------------------------------------
  tone(freq, { type = 'sine', t0 = 0, dur = 0.4, gain = 0.2, attack = 0.01,
    detune = 0, glideTo = null, reverb = 0.5, pan = 0 } = {}) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const start = ctx.currentTime + t0;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, glideTo), start + dur);
    osc.detune.value = detune;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), start + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);

    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (p) p.pan.value = pan;

    osc.connect(g);
    if (p) { g.connect(p); p.connect(this.sfxBus); } else { g.connect(this.sfxBus); }
    if (reverb > 0 && this.convolver) {
      const sendGain = ctx.createGain();
      sendGain.gain.value = reverb;
      g.connect(sendGain);
      sendGain.connect(this.convolver);
    }
    osc.start(start);
    osc.stop(start + dur + 0.05);
  }

  noise({ t0 = 0, dur = 0.4, gain = 0.2, filter = 'bandpass', freq = 1200,
    q = 1, sweepTo = null, reverb = 0.4 } = {}) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const start = ctx.currentTime + t0;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;

    const biq = ctx.createBiquadFilter();
    biq.type = filter;
    biq.frequency.setValueAtTime(freq, start);
    if (sweepTo) biq.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), start + dur);
    biq.Q.value = q;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), start + Math.min(0.03, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);

    src.connect(biq);
    biq.connect(g);
    g.connect(this.sfxBus);
    if (reverb > 0 && this.convolver) {
      const sendGain = ctx.createGain();
      sendGain.gain.value = reverb;
      g.connect(sendGain);
      sendGain.connect(this.convolver);
    }
    src.start(start);
    src.stop(start + dur + 0.05);
  }

  chord(semis, opts = {}) {
    semis.forEach((s, i) => {
      this.tone(NOTE(s), { ...opts, t0: (opts.t0 || 0) + i * (opts.spread || 0) });
    });
  }

  // -- the voices of the game ---------------------------------------------
  /** A wooden tile or token meeting the table. */
  knock(pitch, gain, dur) {
    this.tone(pitch, { type: 'triangle', dur, gain, glideTo: pitch * 0.55, reverb: 0.3 });
    this.tone(pitch * 2.02, { type: 'sine', dur: dur * 0.5, gain: gain * 0.5, reverb: 0.2 });
    this.noise({ dur: 0.05, gain: gain * 0.5, filter: 'bandpass', freq: 2200, q: 1.2, reverb: 0.2 });
  }

  /** A small bird, two or three notes, rising. */
  chirp(base, count, gain) {
    for (let i = 0; i < count; i++) {
      this.tone(base * (1 + i * 0.22), {
        type: 'sine',
        t0: i * 0.075,
        dur: 0.085,
        gain,
        glideTo: base * (1.5 + i * 0.3),
        reverb: 0.5,
        pan: (Math.random() - 0.5) * 0.7,
      });
    }
  }

  play(name) {
    if (!this.ready) return;
    switch (name) {
      case 'tile':
        this.knock(196, 0.22, 0.19);
        break;
      case 'token':
        this.knock(320, 0.15, 0.12);
        break;
      case 'draft':
        this.noise({ dur: 0.22, gain: 0.1, filter: 'bandpass', freq: 1500, sweepTo: 600, q: 0.8, reverb: 0.25 });
        this.tone(NOTE(4), { type: 'triangle', dur: 0.16, gain: 0.07, reverb: 0.3 });
        break;
      case 'rotate':
        this.tone(NOTE(9), { type: 'triangle', dur: 0.07, gain: 0.05, reverb: 0.15 });
        break;
      case 'nature':
        this.chirp(1180, 3, 0.075);
        this.tone(NOTE(16), { type: 'sine', dur: 0.7, gain: 0.05, t0: 0.06, reverb: 0.8 });
        break;
      case 'cull':
        // A flock going up all at once.
        this.noise({ dur: 0.45, gain: 0.14, filter: 'bandpass', freq: 900, sweepTo: 2600, q: 0.6, reverb: 0.5 });
        for (let i = 0; i < 5; i++) {
          this.chirp(700 + Math.random() * 600, 2, 0.035);
        }
        break;
      case 'turn':
        this.knock(262, 0.14, 0.16);
        this.chirp(880, 2, 0.055);
        break;
      case 'finish':
        [0, 7, 12, 16, 19].forEach((semi, i) => {
          this.tone(NOTE(semi - 12), {
            type: 'triangle', dur: 2.4, gain: 0.085, t0: i * 0.13, reverb: 0.9,
          });
        });
        break;
      case 'score':
        this.tone(NOTE(12), { type: 'sine', dur: 0.3, gain: 0.07, glideTo: NOTE(19), reverb: 0.5 });
        break;
      case 'join':
        this.tone(NOTE(0), { type: 'triangle', dur: 0.3, gain: 0.08, glideTo: NOTE(7), reverb: 0.5 });
        break;
      case 'leave':
        this.tone(NOTE(7), { type: 'triangle', dur: 0.3, gain: 0.07, glideTo: NOTE(0), reverb: 0.5 });
        break;
      case 'hover':
        this.tone(NOTE(21), { type: 'sine', dur: 0.05, gain: 0.025, reverb: 0.1 });
        break;
      case 'click':
        this.knock(420, 0.09, 0.08);
        break;
      case 'select':
        this.tone(NOTE(12), { type: 'sine', dur: 0.16, gain: 0.06, glideTo: NOTE(16), reverb: 0.3 });
        break;
      case 'error':
        this.tone(NOTE(-7), { type: 'square', dur: 0.14, gain: 0.055, glideTo: NOTE(-14), reverb: 0.15 });
        break;
      case 'chat':
        this.chirp(1400, 1, 0.04);
        break;
      default:
        break;
    }
  }

  // -- music and ambient bed ----------------------------------------------
  /**
   * Wind and birds under a recorded track, fading up so it does not announce
   * itself. Everything here runs through musicBus, so the Ambience slider
   * still governs the lot.
   */
  startMusic() {
    if (!this.ready || this.ambient) return;
    this.ambient = { chord: 0 };
    this.startTrack();

    // Wind: filtered noise with a wandering cutoff.
    const ctx = this.ctx;
    const wind = ctx.createBufferSource();
    wind.buffer = this.noiseBuffer;
    wind.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 420;
    windFilter.Q.value = 0.6;
    const windGain = ctx.createGain();
    windGain.gain.value = 0.032;
    wind.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(this.musicBus);
    wind.start();
    this.ambient.wind = { source: wind, filter: windFilter };

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.045;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 230;
    lfo.connect(lfoGain);
    lfoGain.connect(windFilter.frequency);
    lfo.start();
    this.ambient.lfo = lfo;

    const CHORDS = [[-12, -5, 0, 7], [-10, -3, 2, 9], [-14, -7, -2, 5], [-12, -5, 4, 7]];
    const pad = () => {
      if (!this.ambient) return;
      // A bird every so often, never on the beat. The chords underneath only
      // play if the recording could not be loaded -- two pieces of music at
      // once is worse than either.
      this.maybeBird();
      if (this.track) return;
      const chord = CHORDS[this.ambient.chord % CHORDS.length];
      this.ambient.chord += 1;
      for (const semi of chord) {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = NOTE(semi) * 0.5;
        osc.detune.value = (Math.random() - 0.5) * 9;
        const g = ctx.createGain();
        const now = ctx.currentTime;
        g.gain.setValueAtTime(0.0001, now);
        g.gain.exponentialRampToValueAtTime(0.035, now + 3.2);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 9.5);
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 900;
        osc.connect(lp);
        lp.connect(g);
        g.connect(this.musicBus);
        osc.start(now);
        osc.stop(now + 10);
      }
    };
    pad();
    this.ambient.timer = setInterval(pad, 9000);
  }

  maybeBird() {
    if (Math.random() >= 0.55) return;
    setTimeout(() => {
      if (!this.ambient) return;
      const save = this.settings.sfx;
      this.sfxBus.gain.value = save * 0.35;
      this.chirp(900 + Math.random() * 700, 2 + Math.floor(Math.random() * 2), 0.03);
      setTimeout(() => { if (this.ready) this.sfxBus.gain.value = this.settings.sfx; }, 400);
    }, 1500 + Math.random() * 5000);
  }

  /** The recorded track, streamed and looped under everything else. */
  startTrack() {
    if (this.track || typeof Audio === 'undefined') return;
    const media = new Audio();
    media.src = MUSIC_URL;
    media.loop = true;
    media.preload = 'auto';
    media.crossOrigin = 'anonymous';

    const fail = () => {
      // Leave this.track null so the synthesised pad keeps the bed alive.
      media.removeEventListener('error', fail);
      this.track = null;
    };
    media.addEventListener('error', fail);

    let node;
    try {
      node = this.ctx.createMediaElementSource(media);
    } catch (err) {
      fail();
      return;
    }
    const gain = this.ctx.createGain();
    gain.gain.value = 0.0001;
    node.connect(gain);
    gain.connect(this.musicBus);
    this.track = { media, gain };

    const play = media.play();
    if (play && play.catch) play.catch(() => { /* blocked until a gesture */ });
    // Steal in rather than starting mid-phrase at full level.
    gain.gain.setTargetAtTime(MUSIC_TRIM, this.ctx.currentTime, MUSIC_FADE / 3);
  }

  stopMusic() {
    if (this.track) {
      const { media, gain } = this.track;
      this.track = null;
      gain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, MUSIC_FADE / 4);
      setTimeout(() => { try { media.pause(); } catch (e) { /* gone */ } }, MUSIC_FADE * 1000);
    }
    if (!this.ambient) return;
    clearInterval(this.ambient.timer);
    try { this.ambient.wind.source.stop(); } catch (e) { /* already stopped */ }
    try { this.ambient.lfo.stop(); } catch (e) { /* already stopped */ }
    this.ambient = null;
  }
}

export const audio = new AudioEngine();
