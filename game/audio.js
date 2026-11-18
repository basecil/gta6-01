// Sound is synthesised, never loaded: a tiny WebAudio kit of oscillators and noise for gunshots,
// sirens, engines, footsteps and the radio-style bass loop. Every entry point is wrapped so a
// missing/blocked AudioContext just means silence; the game never depends on this module.
//
// Browsers refuse to start an AudioContext before a user gesture, so `arm()` installs one-shot
// listeners on the first click/keypress and calls `start()` from there. The radio has three
// stations (a bass loop, a slow pad and a siren-lit chase bed) that share the same graph.

export function createAudio() {
  let ctx = null;
  let master = null;
  let musicGain = null;
  let sfxGain = null;
  let engineOsc = null;
  let engineGain = null;
  let sirenOsc = null;
  let sirenGain = null;
  let rotorOsc = null;
  let rotorOscGain = null;
  let rotorNoise = null;
  let rotorNoiseGain = null;
  let noiseBuffer = null;
  let musicTimer = null;
  let muted = false;
  let started = false;
  let station = 0;
  let engineOn = false;
  let rotorOn = false;
  let armed = false;
  const STATIONS = ['BAY FM 88.1', 'PIER 9 SLOW', 'CHASE BED'];

  function ensure() {
    if (ctx) return ctx;
    try {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = 0.55;
      master.connect(ctx.destination);
      sfxGain = ctx.createGain();
      sfxGain.gain.value = 0.9;
      sfxGain.connect(master);
      musicGain = ctx.createGain();
      musicGain.gain.value = 0.3;
      musicGain.connect(master);
      const length = Math.floor(ctx.sampleRate * 0.6);
      noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      // A deterministic hash-noise fill: no Math.random, so the kit sounds the same every run.
      let state = 0x9e3779b9;
      for (let index = 0; index < length; index += 1) {
        state = (state * 1664525 + 1013904223) >>> 0;
        data[index] = ((state / 4294967296) * 2 - 1) * (1 - index / length);
      }
      return ctx;
    } catch {
      ctx = null;
      return null;
    }
  }

  function tone({ freq = 440, type = 'sine', duration = 0.2, gain = 0.2, sweep = null, target = sfxGain }) {
    if (!ensure() || muted) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (sweep) osc.frequency.exponentialRampToValueAtTime(Math.max(30, sweep), now + duration);
    amp.gain.setValueAtTime(0.0001, now);
    amp.gain.exponentialRampToValueAtTime(gain, now + 0.008);
    amp.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(amp).connect(target);
    osc.start(now);
    osc.stop(now + duration + 0.03);
  }

  function noise({ duration = 0.12, gain = 0.3, filter = 1400 }) {
    if (!ensure() || muted) return;
    const now = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = filter;
    band.Q.value = 0.8;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, now);
    amp.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(band).connect(amp).connect(sfxGain);
    source.start(now);
    source.stop(now + duration);
  }

  function startMusic() {
    if (!ensure() || musicTimer || muted) return;
    const bass = station === 2
      ? [49, 49, 55, 58.3, 49, 49, 43.7, 55]
      : station === 1
        ? [43.7, 43.7, 49, 55, 43.7, 58.3, 49, 41.2]
        : [55, 55, 65.4, 49, 55, 55, 73.4, 65.4];
    const lead = station === 2
      ? [196, 233.1, 196, 174.6, 196, 233.1, 261.6, 233.1]
      : station === 1
        ? [174.6, 196, 220, 196, 174.6, 164.8, 196, 174.6]
        : [220, 261.6, 196, 220, 293.7, 261.6, 196, 164.8];
    let step = 0;
    const tick = () => {
      if (muted) return;
      const now = ctx.currentTime;
      const root = bass[step % bass.length];
      tone({ freq: root, type: 'triangle', duration: 0.5, gain: 0.12, target: musicGain });
      tone({ freq: root * 2, type: 'sine', duration: 0.36, gain: 0.05, target: musicGain });
      if (step % 2 === 0) {
        tone({ freq: lead[(step / 2) % lead.length], type: 'square', duration: 0.34, gain: 0.022, target: musicGain });
      }
      if (step % 4 === 2) noise({ duration: 0.06, gain: 0.06, filter: 3800 });
      void now;
      step += 1;
    };
    tick();
    musicTimer = setInterval(tick, 480);
  }

  function stopMusic() {
    if (musicTimer) clearInterval(musicTimer);
    musicTimer = null;
  }

  function footstep(speed = 0) {
    try {
      if (!ensure() || muted) return;
      const gain = Math.min(0.09, 0.02 + Math.abs(speed) * 0.008);
      noise({ duration: 0.055, gain, filter: 620 + Math.abs(speed) * 40 });
    } catch { /* silence */ }
  }

  function arm() {
    if (armed) return;
    armed = true;
    const kick = () => {
      window.removeEventListener('pointerdown', kick);
      window.removeEventListener('keydown', kick);
      try { api.start(); } catch { /* silence */ }
    };
    window.addEventListener('pointerdown', kick, { once: true });
    window.addEventListener('keydown', kick, { once: true });
  }

  const api = {
    start() {
      if (started) {
        if (ctx && ctx.state === 'suspended') ctx.resume?.();
        return;
      }
      started = true;
      try {
        ensure();
        ctx?.resume?.();
        startMusic();
      } catch {
        /* audio is optional */
      }
    },
    shot() {
      try {
        noise({ duration: 0.16, gain: 0.34, filter: 900 });
        tone({ freq: 220, type: 'square', duration: 0.09, gain: 0.14, sweep: 60 });
      } catch { /* silence */ }
    },
    melee() {
      try { noise({ duration: 0.09, gain: 0.16, filter: 500 }); } catch { /* silence */ }
    },
    hit() {
      try { tone({ freq: 880, type: 'sine', duration: 0.06, gain: 0.12, sweep: 520 }); } catch { /* silence */ }
    },
    reload() {
      try {
        tone({ freq: 320, type: 'square', duration: 0.05, gain: 0.1 });
        setTimeout(() => { try { tone({ freq: 210, type: 'square', duration: 0.06, gain: 0.1 }); } catch { /* silence */ } }, 130);
      } catch { /* silence */ }
    },
    horn() {
      try {
        tone({ freq: 330, type: 'sawtooth', duration: 0.22, gain: 0.1 });
        tone({ freq: 415, type: 'sawtooth', duration: 0.22, gain: 0.08 });
      } catch { /* silence */ }
    },
    pickup() {
      try {
        tone({ freq: 523, type: 'sine', duration: 0.12, gain: 0.14 });
        setTimeout(() => { try { tone({ freq: 784, type: 'sine', duration: 0.16, gain: 0.12 }); } catch { /* silence */ } }, 110);
      } catch { /* silence */ }
    },
    alert() {
      try { tone({ freq: 160, type: 'sawtooth', duration: 0.4, gain: 0.11, sweep: 320 }); } catch { /* silence */ }
    },
    engine(on, speed = 0) {
      try {
        if (on !== engineOn) {
          engineOn = on;
          if (on) api.start();
        }
        if (!ensure()) return;
        if (!engineOsc) {
          engineOsc = ctx.createOscillator();
          engineGain = ctx.createGain();
          engineOsc.type = 'sawtooth';
          engineGain.gain.value = 0;
          engineOsc.connect(engineGain).connect(sfxGain);
          engineOsc.start();
        }
        const now = ctx.currentTime;
        const target = on && !muted ? Math.min(0.085, 0.03 + Math.abs(speed) * 0.0016) : 0;
        engineGain.gain.setTargetAtTime(target, now, 0.15);
        engineOsc.frequency.setTargetAtTime(46 + Math.abs(speed) * 2.6, now, 0.2);
      } catch { /* silence */ }
    },
    siren(on) {
      try {
        if (!armed && !started) return;
        if (!ensure()) return;
        if (!sirenOsc) {
          sirenOsc = ctx.createOscillator();
          sirenGain = ctx.createGain();
          sirenOsc.type = 'sine';
          sirenGain.gain.value = 0;
          sirenOsc.connect(sirenGain).connect(sfxGain);
          sirenOsc.start();
        }
        const now = ctx.currentTime;
        if (on && !muted) {
          sirenOsc.frequency.setValueAtTime(660, now);
          sirenOsc.frequency.linearRampToValueAtTime(940, now + 0.55);
          sirenGain.gain.setTargetAtTime(0.035, now, 0.12);
        } else {
          sirenGain.gain.setTargetAtTime(0, now, 0.2);
        }
      } catch { /* silence */ }
    },
    // Air support: a sawtooth rotor chop over a band-passed noise bed. Built once and gain-ramped,
    // so the heli spawn/despawn never clicks and a headless/blocked context stays silent.
    rotorLoop(on) {
      try {
        if (on !== rotorOn) {
          rotorOn = on;
        }
        // Same rule as siren(): never wake an AudioContext before the player interacts.
        if (!armed && !started) return;
        if (!ensure() || !noiseBuffer) return;
        if (!rotorOsc) {
          rotorOsc = ctx.createOscillator();
          rotorOscGain = ctx.createGain();
          rotorOsc.type = 'sawtooth';
          rotorOsc.frequency.value = 21;
          rotorOscGain.gain.value = 0;
          rotorOsc.connect(rotorOscGain).connect(sfxGain);
          rotorOsc.start();

          rotorNoise = ctx.createBufferSource();
          rotorNoise.buffer = noiseBuffer;
          rotorNoise.loop = true;
          const band = ctx.createBiquadFilter();
          band.type = 'bandpass';
          band.frequency.value = 320;
          band.Q.value = 0.9;
          rotorNoiseGain = ctx.createGain();
          rotorNoiseGain.gain.value = 0;
          rotorNoise.connect(band).connect(rotorNoiseGain).connect(sfxGain);
          rotorNoise.start();
        }
        const now = ctx.currentTime;
        const live = on && !muted;
        const level = live ? 0.055 : 0;
        rotorOscGain.gain.setTargetAtTime(level, now, 0.25);
        rotorNoiseGain.gain.setTargetAtTime(live ? 0.05 : 0, now, 0.25);
        // A slow chop in pitch, deterministic in time, so the rotor reads as a rotor not a drone.
        const chop = live ? 18 + Math.sin(now * 8.5) * 1.6 : 16;
        rotorOsc.frequency.setTargetAtTime(chop, now, 0.2);
      } catch { /* silence */ }
    },
    toggleMute() {
      muted = !muted;
      try {
        if (master) master.gain.setTargetAtTime(muted ? 0 : 0.55, ctx.currentTime, 0.05);
        if (muted) stopMusic();
        else startMusic();
      } catch { /* silence */ }
      return muted;
    },
    footstep,
    arm,
    radio(label = true) {
      station = (station + 1) % STATIONS.length;
      if (started && !muted) {
        stopMusic();
        startMusic();
      }
      return label ? STATIONS[station] : station;
    },
    stationName() {
      return STATIONS[station];
    },
    get muted() {
      return muted;
    },
  };
  return api;
}
