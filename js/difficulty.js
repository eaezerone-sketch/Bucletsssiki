(function () {
  'use strict';
  var ORB = window.ORB = window.ORB || {};

  // Linear ramp from `from` to `to` over planets [start, end], clamped outside (v1 fields).
  function ramp(p, from, to, start, end) {
    var t = Math.min(1, Math.max(0, (p - start) / (end - start)));
    return from + (to - from) * t;
  }

  // Eased curve through [planets, value] knots. Each segment is smoothstep-eased,
  // so values rise and settle without kinks. Clamped outside the first/last knot.
  function curve(p, pts) {
    if (p <= pts[0][0]) return pts[0][1];
    for (var i = 1; i < pts.length; i++) {
      if (p <= pts[i][0]) {
        var a = pts[i - 1], b = pts[i];
        var t = (p - a[0]) / (b[0] - a[0]);
        t = t * t * (3 - 2 * t);
        return a[1] + (b[1] - a[1]) * t;
      }
    }
    return pts[pts.length - 1][1];
  }

  // Knots are constant, defined once (no per-call allocation).
  var TYPE_KNOTS = {
    rocky:   [[0, 5], [40, 3]],
    gas:     [[0, 1], [40, 2]],
    ice:     [[0, 0], [3, 0], [7, 2], [40, 2]],
    lava:    [[0, 0], [2, 0], [6, 2], [40, 2]],
    jelly:   [[0, 0], [4, 0], [8, 2], [40, 2]],
    star:    [[0, 0], [6, 0], [12, 1.5], [40, 1.5]],
    crumble: [[0, 0], [8, 0], [14, 1.5], [40, 1.5]]
  };
  var BLACKHOLE_KNOTS = [[0, 0], [10, 0], [16, 0.06], [50, 0.22]];
  var COMET_KNOTS = [[0, 0], [5, 0], [9, 0.06], [60, 0.2]];
  var WORMHOLE_KNOTS = [[0, 0], [6, 0], [10, 0.1], [60, 0.16]];
  var VOID_KNOTS = [[0, 16], [10, 23], [25, 44], [45, 66], [70, 78], [100, 105]];

  function typeWeights(p) {
    return {
      rocky: curve(p, TYPE_KNOTS.rocky),
      ice: curve(p, TYPE_KNOTS.ice),
      gas: curve(p, TYPE_KNOTS.gas),
      lava: curve(p, TYPE_KNOTS.lava),
      jelly: curve(p, TYPE_KNOTS.jelly),
      star: curve(p, TYPE_KNOTS.star),
      crumble: curve(p, TYPE_KNOTS.crumble)
    };
  }

  ORB.Difficulty = {
    // planets = number of planets visited so far
    get: function (planets) {
      var p = Math.max(0, planets || 0);
      return {
        // v1 fields (linear ramps, unchanged)
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
        powerChance: 0.14,

        // v2 fields (eased curves, nothing special before the unlock thresholds)
        typeWeights: typeWeights(p),
        blackholeChance: curve(p, BLACKHOLE_KNOTS),
        cometRate: curve(p, COMET_KNOTS),
        wormholeChance: curve(p, WORMHOLE_KNOTS),
        voidSpeed: curve(p, VOID_KNOTS)
      };
    }
  };
})();
