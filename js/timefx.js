(function () {
  'use strict';
  var ORB = window.ORB = window.ORB || {};

  var HITSTOP_MAX = 0.12;   // longest freeze allowed, real seconds
  var HOLD_SHARE = 0.6;     // slowmo holds its factor for 60% of dur, eases back over the last 40%

  var hitRem = 0;           // freeze time left (real seconds)
  var slowOn = false;       // a slowmo is active
  var slowFactor = 1;       // factor of the active slowmo
  var slowDur = 0;          // total duration of the active slowmo (real seconds)
  var slowT = 0;            // elapsed time of the active slowmo (real seconds)

  function num(v, def) {
    return (typeof v === 'number' && v === v) ? v : def;   // v === v rejects NaN
  }

  // Slowmo factor at elapsed time t: holds, then smoothsteps back to 1.
  function factorAt(t) {
    if (!slowOn || t >= slowDur) return 1;
    var hold = slowDur * HOLD_SHARE;
    if (t <= hold) return slowFactor;
    var u = (t - hold) / (slowDur - hold);
    u = u * u * (3 - 2 * u);
    return slowFactor + (1 - slowFactor) * u;
  }

  ORB.TimeFX = {
    // Clear all effects.
    reset: function () {
      hitRem = 0;
      slowOn = false;
      slowFactor = 1;
      slowDur = 0;
      slowT = 0;
    },

    // Freeze game time for dur seconds (capped at 0.12). Overlaps: longest freeze wins.
    hitstop: function (dur) {
      var d = Math.min(Math.max(num(dur, 0), 0), HITSTOP_MAX);
      if (d > hitRem) hitRem = d;
    },

    // Scale game time by factor for dur seconds, easing back to 1 over the last 40%.
    // Overlaps: the stronger (lower) factor wins; equal factors keep the longer one.
    slowmo: function (factor, dur) {
      var f = Math.min(Math.max(num(factor, 1), 0), 1);
      var d = num(dur, 0);
      if (d <= 0) return;
      var cur = factorAt(slowT);
      var remaining = slowOn ? slowDur - slowT : 0;
      if (f < cur - 1e-6 || (Math.abs(f - cur) <= 1e-6 && d > remaining)) {
        slowOn = true;
        slowFactor = f;
        slowDur = d;
        slowT = 0;
      }
    },

    // Advance effect timers by realDt; returns the scaled game dt for this frame.
    update: function (realDt) {
      var dt = Math.max(num(realDt, 0), 0);
      var frozen = Math.min(dt, hitRem);
      hitRem -= frozen;
      var live = dt - frozen;

      slowT += dt;                       // slowmo runs on real time, also during freezes
      if (slowOn && slowT >= slowDur) slowOn = false;
      return live * factorAt(slowT);
    },

    // Current time factor (read-only): 0 while frozen, else the slowmo factor (1 when idle).
    get scale() {
      return hitRem > 0 ? 0 : factorAt(slowT);
    }
  };
})();
