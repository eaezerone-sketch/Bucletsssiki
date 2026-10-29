(function () {
  'use strict';
  var ORB = window.ORB = window.ORB || {};

  var ctx = null;      // AudioContext, created lazily
  var master = null;   // master gain (~0.35)
  var noiseBuf = null; // 1 s of white noise, reused for whooshes and crashes
  var muted = null;    // read from storage on first isMuted() call

  // Create the AudioContext on first use. Returns null if WebAudio is missing.
  function ensureCtx() {
    if (ctx) return ctx;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      var c = new AC();
      var m = c.createGain();
      m.gain.value = 0.35;
      m.connect(c.destination);
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

  // One oscillator note with a quick exponential envelope. f1 is an optional sweep target.
  function tone(type, f0, f1, t, dur, vol) {
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  // Filtered noise burst (whoosh, crash). Filter frequency can sweep from f0 to f1.
  function noise(t, dur, vol, filterType, f0, f1) {
    var s = ctx.createBufferSource();
    var flt = ctx.createBiquadFilter();
    var g = ctx.createGain();
    s.buffer = noiseBuf;
    flt.type = filterType;
    flt.frequency.setValueAtTime(f0, t);
    if (f1) flt.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(flt);
    flt.connect(g);
    g.connect(master);
    s.start(t);
    s.stop(t + dur + 0.02);
  }

  // Each sound schedules its notes starting at time t (AudioContext seconds).
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
    }
  };

  ORB.Audio = {
    // Create or resume the context. Safe to call often (e.g. on every user gesture).
    unlock: function () {
      try {
        var c = ensureCtx();
        if (c && c.state === 'suspended') {
          var p = c.resume();
          if (p && p.catch) p.catch(function () {});
        }
      } catch (e) { /* no audio, ignore */ }
    },

    play: function (name) {
      try {
        if (!SOUNDS[name] || ORB.Audio.isMuted()) return;
        if (!ensureCtx()) return;
        if (ctx.state === 'suspended') {
          var p = ctx.resume();
          if (p && p.catch) p.catch(function () {});
        }
        SOUNDS[name](ctx.currentTime + 0.01);
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
