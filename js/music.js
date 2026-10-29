(function () {
  'use strict';
  var ORB = window.ORB = window.ORB || {};

  // Generative ambient score: no audio files. A soft detuned pad (A dorian: Am, Dm, G, Em)
  // plus a sparse A minor pentatonic arpeggio routed through a feedback delay.
  // Everything is scheduled ahead on the AudioContext clock by a lookahead timer.

  var BUS_LEVEL = 0.18;     // music bus gain: keeps the score under the sound effects
  var TICK_MS = 100;        // scheduler interval
  var LOOKAHEAD = 0.2;      // seconds of arpeggio notes scheduled ahead of currentTime
  var CHORD_HOLD = 14;      // seconds per chord (randomised +-15%)
  var PAD_DETUNE = [-6, 0, 6];  // cents, one oscillator per chord tone
  var PAD_VOICE_GAIN = 0.1;

  // Chords as semitone offsets from A2 (110 Hz).
  var CHORDS = [[0, 3, 7], [5, 9, 12], [-2, 2, 5], [-5, -2, 2]];
  var PENT = [0, 3, 5, 7, 10];       // A minor pentatonic degrees
  var ARP_NOTES = [];                // frequencies, A3 .. G5
  var STEP_MOVES = [-2, -1, -1, 1, 1, 2];

  for (var k = 0; k < 10; k++) {
    ARP_NOTES.push(midiFreq(12 + ((k / 5) | 0) * 12 + PENT[k % 5]));
  }

  var ctx = null;          // AudioContext (shared with ORB.Audio when available)
  var graph = false;       // true once the node graph is built
  var bus = null;          // music bus gain -> destination
  var padFilter = null;
  var padLevel = null;
  var padVoices = [];      // oscillators, one per chord tone
  var arpFilter = null;
  var delayOut = null;

  var timer = null;
  var running = false;     // start() called and stop() not yet called
  var musicMuted = false;  // setMuted(true)
  var intensity = 0;       // smoothed 0..1
  var intensityTarget = 0;
  var chordIdx = 0;
  var nextChordTime = 0;
  var nextArpTime = 0;
  var arpIdx = 4;
  var lastBusTarget = -1;
  var lastParamI = -1;

  function midiFreq(semi) {
    return 110 * Math.pow(2, semi / 12);
  }

  function sfxMuted() {
    try {
      return !!(ORB.Audio && ORB.Audio.isMuted && ORB.Audio.isMuted());
    } catch (e) {
      return false;
    }
  }

  function audible() {
    return running && !musicMuted && !sfxMuted();
  }

  // Use the shared context from ORB.Audio, or create our own. Returns false if no WebAudio.
  function acquire() {
    if (ctx) return true;
    var c = null;
    try {
      var shared = (ORB.Audio && ORB.Audio.getContext) ? ORB.Audio.getContext() : null;
      if (shared && shared.ctx) c = shared.ctx;
    } catch (e) { c = null; }
    if (!c) {
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (AC) c = new AC();
      } catch (e) { c = null; }
    }
    ctx = c;
    return !!ctx;
  }

  function build() {
    var c = ctx;

    bus = c.createGain();
    bus.gain.value = 0;
    bus.connect(c.destination);

    // Pad: 3 detuned sawtooths -> lowpass (slowly breathed by an LFO) -> level -> bus.
    padFilter = c.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = 420;
    padFilter.Q.value = 0.7;
    padLevel = c.createGain();
    padLevel.gain.value = 0.5;
    padFilter.connect(padLevel);
    padLevel.connect(bus);

    var lfo = c.createOscillator();
    lfo.frequency.value = 0.05 + Math.random() * 0.03;
    var lfoDepth = c.createGain();
    lfoDepth.gain.value = 110;
    lfo.connect(lfoDepth);
    lfoDepth.connect(padFilter.frequency);
    lfo.start();

    padVoices = [];
    for (var i = 0; i < 3; i++) {
      var o = c.createOscillator();
      o.type = 'sawtooth';
      o.detune.value = PAD_DETUNE[i];
      o.frequency.value = midiFreq(CHORDS[chordIdx][i]);
      var vg = c.createGain();
      vg.gain.value = PAD_VOICE_GAIN;
      o.connect(vg);
      vg.connect(padFilter);
      o.start();
      padVoices.push(o);
    }

    // Arpeggio: triangle notes -> lowpass (brightens with intensity) -> bus,
    // and also -> feedback delay (lowpassed in the loop) -> bus.
    arpFilter = c.createBiquadFilter();
    arpFilter.type = 'lowpass';
    arpFilter.frequency.value = 900;
    arpFilter.Q.value = 0.4;
    arpFilter.connect(bus);

    var delayIn = c.createGain();
    delayIn.gain.value = 0.7;
    var delay = c.createDelay(2);
    delay.delayTime.value = 0.42;
    var fb = c.createGain();
    fb.gain.value = 0.42;
    var dLp = c.createBiquadFilter();
    dLp.type = 'lowpass';
    dLp.frequency.value = 2000;
    delayOut = c.createGain();
    delayOut.gain.value = 0.5;

    arpFilter.connect(delayIn);
    delayIn.connect(delay);
    delay.connect(dLp);
    dLp.connect(fb);
    fb.connect(delay);
    dLp.connect(delayOut);
    delayOut.connect(bus);

    graph = true;
  }

  // Fade the bus toward 0 or BUS_LEVEL only when the audible state changes.
  function refreshBus() {
    if (!graph) return;
    var target = audible() ? BUS_LEVEL : 0;
    if (target === lastBusTarget) return;
    lastBusTarget = target;
    var t = ctx.currentTime;
    bus.gain.cancelScheduledValues(t);
    bus.gain.setValueAtTime(bus.gain.value, t);
    bus.gain.setTargetAtTime(target, t, target > 0 ? 1.2 : 0.5);
  }

  // Map the smoothed intensity onto filters and levels (only when it changed noticeably).
  function applyParams(force) {
    if (!graph) return;
    if (!force && Math.abs(intensity - lastParamI) < 0.01) return;
    lastParamI = intensity;
    var t = ctx.currentTime;
    padFilter.frequency.setTargetAtTime(380 + 600 * intensity, t, 0.8);
    padLevel.gain.setTargetAtTime(0.45 + 0.3 * intensity, t, 0.8);
    arpFilter.frequency.setTargetAtTime(900 + 2600 * intensity, t, 0.8);
    delayOut.gain.setTargetAtTime(0.45 + 0.2 * intensity, t, 0.8);
  }

  function playNote(freq, t, vel) {
    var c = ctx;
    var o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq;
    var g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vel, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.0);
    o.connect(g);
    g.connect(arpFilter);
    o.start(t);
    o.stop(t + 2.05);
  }

  // One arpeggio grid step at time t: random walk over the pentatonic notes, sparse onsets.
  function scheduleStep(t) {
    var p = 0.1 + 0.45 * intensity;
    if (Math.random() < 0.2) {
      arpIdx = (Math.random() * ARP_NOTES.length) | 0;
    } else {
      arpIdx += STEP_MOVES[(Math.random() * STEP_MOVES.length) | 0];
      if (arpIdx < 0) arpIdx = 0;
      if (arpIdx >= ARP_NOTES.length) arpIdx = ARP_NOTES.length - 1;
    }
    if (Math.random() < p) {
      playNote(ARP_NOTES[arpIdx], t, 0.22 + 0.1 * Math.random());
    }
  }

  // Irregular step length; higher intensity makes steps shorter (busier).
  function stepLen() {
    return (0.55 - 0.25 * intensity) * (0.75 + 0.5 * Math.random());
  }

  function tick() {
    if (!graph || !ctx) return;
    try {
      var now = ctx.currentTime;
      intensity += (intensityTarget - intensity) * 0.05;
      refreshBus();
      applyParams(false);
      if (!running) return;

      if (now >= nextChordTime) {
        chordIdx = (chordIdx + 1) % CHORDS.length;
        var ch = CHORDS[chordIdx];
        for (var i = 0; i < padVoices.length; i++) {
          padVoices[i].frequency.setTargetAtTime(midiFreq(ch[i]), now, 2.0);
        }
        nextChordTime = now + CHORD_HOLD * (0.85 + 0.3 * Math.random());
      }

      if (!audible()) {
        // Silent (muted or sound off): schedule nothing, avoid a burst on unmute.
        nextArpTime = now + 0.1;
        return;
      }

      if (nextArpTime < now + 0.05) nextArpTime = now + 0.05;
      var horizon = now + LOOKAHEAD;
      while (nextArpTime < horizon) {
        scheduleStep(nextArpTime);
        nextArpTime += stepLen();
      }
    } catch (e) { /* audio hiccup, try again next tick */ }
  }

  ORB.Music = {
    // Start the score (call from a user gesture, e.g. Play / first tap). Safe to repeat.
    start: function () {
      if (running) return;
      try {
        if (!acquire()) return;
        if (!graph) build();
        if (ctx.state === 'suspended') {
          var p = ctx.resume();
          if (p && p.catch) p.catch(function () {});
        }
        var now = ctx.currentTime;
        running = true;
        nextChordTime = now + CHORD_HOLD;
        nextArpTime = now + 1.5;
        lastParamI = -1;
        if (!timer) timer = setInterval(tick, TICK_MS);
        refreshBus();
        tick();
      } catch (e) { /* no audio, ignore */ }
    },

    // Stop scheduling and fade out. The graph is kept for a quick restart.
    stop: function () {
      running = false;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      try { refreshBus(); } catch (e) { /* ignore */ }
    },

    // Target intensity 0..1 (e.g. max(danger, combo/5)); the change is smoothed.
    setIntensity: function (v) {
      v = +v;
      if (!(v >= 0)) v = 0;
      if (v > 1) v = 1;
      intensityTarget = v;
    },

    // Music-only mute. The sound toggle (ORB.Audio.isMuted) also silences the score.
    setMuted: function (b) {
      musicMuted = !!b;
      try { refreshBus(); } catch (e) { /* ignore */ }
    },

    isPlaying: function () {
      return running;
    }
  };
})();
