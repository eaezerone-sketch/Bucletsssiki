(function () {
  'use strict';
  var ORB = window.ORB = window.ORB || {};

  var ctx = null;      // AudioContext, created lazily
  var master = null;   // master gain (~0.35) -> compressor -> destination
  var noiseBuf = null; // 1 s of white noise, reused for whooshes and crashes
  var muted = null;    // read from storage on first isMuted() call
  var lastAt = {};     // last start time per sound name (anti-stacking)

  // Create the AudioContext on first use. Returns null if WebAudio is missing.
  function ensureCtx() {
    if (ctx) return ctx;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      var c = new AC();
      var m = c.createGain();
      m.gain.value = 0.35;
      // Gentle limiter so stacked sounds never clip.
      var comp = c.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.knee.value = 10;
      comp.ratio.value = 4;
      comp.attack.value = 0.003;
      comp.release.value = 0.25;
      m.connect(comp);
      comp.connect(c.destination);
      var buf = c.createBuffer(1, c.sampleRate, c.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      ctx = c;
      master = m;
      noiseBuf = buf;
    } catch (e) {
      ctx = null;
    }
    return ctx;
  }

  function resumeIfSuspended() {
    if (ctx && ctx.state === 'suspended') {
      var p = ctx.resume();
      if (p && p.catch) p.catch(function () {});
    }
  }

  // Oscillator voice with a pitch curve and a quick exponential envelope.
  // pts = [[offsetSeconds, freq], ...]; the first point is the start frequency.
  // wob (optional) = {rate, depth}: a vibrato/wobble LFO that fades out with the note.
  // out (optional) = destination node, default master.
  function voice(type, pts, t, dur, vol, wob, out) {
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(pts[0][1], t);
    for (var i = 1; i < pts.length; i++) {
      o.frequency.exponentialRampToValueAtTime(pts[i][1], t + pts[i][0]);
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.01, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(out || master);
    o.start(t);
    o.stop(t + dur + 0.02);
    if (wob) {
      var l = ctx.createOscillator();
      var lg = ctx.createGain();
      l.frequency.value = wob.rate;
      lg.gain.setValueAtTime(wob.depth, t);
      lg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      l.connect(lg);
      lg.connect(o.frequency);
      l.start(t);
      l.stop(t + dur + 0.02);
    }
  }

  // Simple note with an optional sweep from f0 to f1 over dur.
  function tone(type, f0, f1, t, dur, vol) {
    var pts = (f1 && f1 !== f0) ? [[0, f0], [dur, f1]] : [[0, f0]];
    voice(type, pts, t, dur, vol);
  }

  // Filtered noise burst (whoosh, crash). Filter frequency can sweep from f0 to f1.
  function noise(t, dur, vol, filterType, f0, f1, q) {
    var s = ctx.createBufferSource();
    var flt = ctx.createBiquadFilter();
    var g = ctx.createGain();
    s.buffer = noiseBuf;
    flt.type = filterType;
    flt.frequency.setValueAtTime(f0, t);
    if (f1) flt.frequency.exponentialRampToValueAtTime(f1, t + dur);
    if (q) flt.Q.value = q;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(flt);
    flt.connect(g);
    g.connect(master);
    s.start(t);
    s.stop(t + dur + 0.02);
  }

  // Lowpass filter node for sweeping a whole voice (caller connects it onward).
  function lowpass(f0, f1, t, dur, q) {
    var flt = ctx.createBiquadFilter();
    flt.type = 'lowpass';
    flt.Q.value = q || 1;
    flt.frequency.setValueAtTime(f0, t);
    flt.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.5);
    flt.frequency.exponentialRampToValueAtTime(f0, t + dur);
    flt.connect(master);
    return flt;
  }

  function rnd(a, b) { return a + Math.random() * (b - a); }

  // Each sound schedules its notes starting at time t (AudioContext seconds).
  // p is the optional param 0..1 (only 'latch' and a few others use it).
  var SOUNDS = {
    launch: function (t) {
      noise(t, 0.35, 0.25, 'bandpass', 300, 2400);
      tone('sine', 180, 900, t, 0.3, 0.18);
    },
    capture: function (t) {
      tone('sine', 784, null, t, 0.45, 0.22);
      tone('sine', 1568, null, t, 0.3, 0.05);
    },
    perfect: function (t) {
      tone('triangle', 1046, null, t, 0.18, 0.2);
      tone('triangle', 1568, null, t + 0.09, 0.4, 0.2);
    },
    star: function (t) {
      tone('sine', 1800, 2600, t, 0.14, 0.16);
    },
    power: function (t) {
      var notes = [523, 659, 784, 1046];
      for (var i = 0; i < notes.length; i++) {
        tone('square', notes[i], null, t + i * 0.06, 0.12, 0.06);
      }
    },
    shield: function (t) {
      tone('square', 330, null, t, 0.5, 0.1);
      tone('square', 330 * 1.41, null, t, 0.5, 0.06); // inharmonic pair = metallic
      tone('sine', 2200, null, t, 0.2, 0.05);
      noise(t, 0.08, 0.12, 'highpass', 4000, null);
    },
    death: function (t) {
      tone('sawtooth', 440, 90, t, 0.6, 0.14);
      noise(t, 0.5, 0.2, 'lowpass', 1200, 200);
    },
    click: function (t) {
      tone('square', 1800, null, t, 0.02, 0.05);
    },

    // Elastic twang: a yanked-up pitch snaps down and wobbles like a stretched band.
    // Higher p = higher, louder, slightly longer and faster wobble.
    latch: function (t, p) {
      var f = 260 + 340 * p;
      var dur = 0.2 + 0.14 * p;
      var vol = 0.14 + 0.12 * p;
      voice('triangle', [[0, f * 1.8], [0.035, f], [dur, f * 0.78]], t, dur, vol,
        { rate: 24 + 12 * p, depth: f * 0.14 });
      // bright overtone gives the metallic "twang"
      voice('sine', [[0, f * 3.6], [0.035, f * 2], [dur * 0.6, f * 1.6]], t, dur * 0.6, vol * 0.3);
      noise(t, 0.03, 0.05, 'highpass', 3000, null); // tiny snap
    },

    // Whoosh that rises into a bright two-note chime.
    slingshot: function (t) {
      noise(t, 0.5, 0.18, 'bandpass', 300, 2600, 1.5);
      tone('triangle', 784, null, t + 0.18, 0.35, 0.16);
      tone('triangle', 1046, null, t + 0.26, 0.45, 0.16);
      tone('sine', 2092, null, t + 0.26, 0.3, 0.04);
    },

    // Fiery streak passing by with a tiny bright tinkle.
    comet: function (t) {
      noise(t, 0.6, 0.16, 'bandpass', 2400, 700, 2);
      tone('sine', 1200, 2400, t, 0.25, 0.08);
      tone('triangle', 1800, null, t + 0.12, 0.2, 0.06);
    },

    // Phasey sweep: two detuned saws through a sweeping resonant lowpass.
    warp: function (t) {
      var dur = 0.9;
      var fl = lowpass(400, 3000, t, dur, 5);
      voice('sawtooth', [[0, 220], [dur * 0.5, 880], [dur, 330]], t, dur, 0.07, null, fl);
      voice('sawtooth', [[0, 227], [dur * 0.5, 893], [dur, 337]], t, dur, 0.07, null, fl);
    },

    // Rumble with a low thump and a handful of crackles.
    crumble: function (t) {
      noise(t, 0.7, 0.3, 'lowpass', 500, 120);
      voice('sine', [[0, 90], [0.5, 45]], t, 0.5, 0.25);
      for (var i = 0; i < 6; i++) {
        noise(t + 0.05 + i * 0.07 + rnd(0, 0.03), 0.03, 0.08, 'highpass', 2500, null);
      }
    },

    // Sizzle: a hiss with short random crackles.
    burn: function (t) {
      noise(t, 0.6, 0.12, 'bandpass', 4000, 2000, 1.5);
      for (var i = 0; i < 5; i++) {
        noise(t + 0.04 + i * 0.1 + rnd(0, 0.04), 0.025, 0.07, 'bandpass', rnd(2000, 4000), null, 3);
      }
    },

    // Deep growl: a slow-wobbling sawtooth through a dark lowpass, plus a sub.
    void: function (t) {
      var fl = lowpass(180, 420, t, 1.1, 2);
      voice('sawtooth', [[0, 55], [1.1, 40]], t, 1.1, 0.16, { rate: 5, depth: 6 }, fl);
      voice('sine', [[0, 27.5], [1.2, 22]], t, 1.2, 0.2);
      noise(t, 0.9, 0.08, 'lowpass', 160, 90);
    },

    // Pleasant rising C-major arpeggio that resolves into a held chord.
    achievement: function (t) {
      var n = [523, 659, 784, 1046];
      for (var i = 0; i < n.length; i++) {
        tone('triangle', n[i], null, t + i * 0.09, 0.3, 0.14);
      }
      tone('triangle', 1046, null, t + 0.36, 0.8, 0.12);
      tone('triangle', 1318, null, t + 0.36, 0.8, 0.1);
      tone('sine', 1568, null, t + 0.36, 0.8, 0.08);
    },

    // Quick "whew" whoosh with a falling blip.
    nearMiss: function (t) {
      noise(t, 0.22, 0.14, 'bandpass', 1000, 3200, 4);
      tone('sine', 1760, 1320, t + 0.02, 0.14, 0.09);
    }
  };

  ORB.Audio = {
    // Create or resume the context. Safe to call often (e.g. on every user gesture).
    unlock: function () {
      try {
        ensureCtx();
        resumeIfSuspended();
      } catch (e) { /* no audio, ignore */ }
    },

    // Shared WebAudio context for other modules (e.g. music). Returns { ctx, master } or null.
    getContext: function () {
      try {
        if (!ensureCtx()) return null;
        resumeIfSuspended();
        return { ctx: ctx, master: master };
      } catch (e) {
        return null;
      }
    },

    // Play a named sound. param (0..1, optional) shapes some sounds, e.g. 'latch' strength.
    play: function (name, param) {
      try {
        if (!SOUNDS[name] || ORB.Audio.isMuted()) return;
        if (!ensureCtx()) return;
        resumeIfSuspended();
        var now = ctx.currentTime;
        // Skip if the same sound just started (e.g. many asteroids in one frame).
        if (lastAt[name] !== undefined && now - lastAt[name] < 0.04) return;
        lastAt[name] = now;
        var p = typeof param === 'number' && isFinite(param) ? Math.max(0, Math.min(1, param)) : 0.5;
        SOUNDS[name](now + 0.01, p);
      } catch (e) { /* silent no-op */ }
    },

    setMuted: function (b) {
      muted = !!b;
      try { ORB.Storage.set('muted', muted); } catch (e) { /* ignore */ }
    },

    isMuted: function () {
      if (muted === null) {
        try { muted = !!ORB.Storage.get('muted', false); } catch (e) { muted = false; }
      }
      return muted;
    },

    // Flip mute state and return the new value.
    toggle: function () {
      ORB.Audio.setMuted(!ORB.Audio.isMuted());
      return ORB.Audio.isMuted();
    }
  };
})();
