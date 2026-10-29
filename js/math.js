(function () {
  'use strict';
  var ORB = window.ORB = window.ORB || {};

  ORB.M = {
    // Clamp v into [a, b].
    clamp: function (v, a, b) {
      return Math.min(b, Math.max(a, v));
    },

    // Linear interpolation from a to b by t.
    lerp: function (a, b, t) {
      return a + (b - a) * t;
    },

    // Squared distance between two points (avoids sqrt).
    dist2: function (ax, ay, bx, by) {
      var dx = bx - ax, dy = by - ay;
      return dx * dx + dy * dy;
    },

    // Distance between two points.
    dist: function (ax, ay, bx, by) {
      return Math.sqrt(this.dist2(ax, ay, bx, by));
    },

    // Random float in [a, b).
    rand: function (a, b) {
      return a + Math.random() * (b - a);
    },

    // Random integer in [a, b] (inclusive).
    randInt: function (a, b) {
      return Math.floor(a + Math.random() * (b - a + 1));
    },

    // Random element of an array.
    pick: function (arr) {
      return arr[Math.floor(Math.random() * arr.length)];
    },

    // True with probability p.
    chance: function (p) {
      return Math.random() < p;
    },

    // Angle (radians) from point a to point b.
    angle: function (ax, ay, bx, by) {
      return Math.atan2(by - ay, bx - ax);
    },

    // Normalize an angle to -PI..PI.
    wrapAngle: function (a) {
      var TWO_PI = Math.PI * 2;
      a = a % TWO_PI;
      if (a > Math.PI) a -= TWO_PI;
      if (a < -Math.PI) a += TWO_PI;
      return a;
    },

    // Ease-out cubic curve, t in 0..1.
    easeOutCubic: function (t) {
      var u = 1 - t;
      return 1 - u * u * u;
    },

    // CSS hsla() string. h in degrees, s and l in percent, a defaults to 1.
    hsl: function (h, s, l, a) {
      if (a === undefined) a = 1;
      return 'hsla(' + h + ', ' + s + '%, ' + l + '%, ' + a + ')';
    },

    // True if two circles overlap.
    circleHit: function (ax, ay, ar, bx, by, br) {
      var r = ar + br;
      return this.dist2(ax, ay, bx, by) < r * r;
    }
  };
})();
