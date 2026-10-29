(function () {
  'use strict';
  var ORB = window.ORB = window.ORB || {};

  // Linear ramp from `from` to `to` over planets [start, end], clamped outside.
  function ramp(p, from, to, start, end) {
    var t = Math.min(1, Math.max(0, (p - start) / (end - start)));
    return from + (to - from) * t;
  }

  ORB.Difficulty = {
    // planets = number of planets visited so far
    get: function (planets) {
      var p = Math.max(0, planets || 0);
      return {
        angularSpeed: ramp(p, 1.7, 3.2, 0, 60),
        gapMin: ramp(p, 150, 200, 0, 60),
        gapMax: ramp(p, 220, 300, 0, 60),
        radiusMin: 18,
        radiusMax: ramp(p, 34, 24, 0, 60),
        moveChance: p < 8 ? 0 : ramp(p, 0, 0.6, 8, 48),
        moveAmpMin: 25,
        moveAmpMax: ramp(p, 30, 90, 0, 60),
        asteroidRate: p < 4 ? 0 : ramp(p, 0.15, 0.9, 4, 60),
        starChance: 0.75,
        powerChance: 0.14
      };
    }
  };
})();
