(function () {
  'use strict';
  var ORB = window.ORB = window.ORB || {};

  // Vertical-following camera with a decaying screen shake.
  ORB.Camera = {
    x: 0,
    y: 0,
    shakeT: 0,     // seconds of shake left
    shakeMag: 0,   // max shake offset in world px
    shakeDur: 0,   // total shake duration (for decay)

    reset: function (x, y) {
      this.x = x;
      this.y = y;
      this.shakeT = 0;
      this.shakeMag = 0;
      this.shakeDur = 0;
    },

    update: function (dt, targetY) {
      var C = ORB.CONFIG;
      // x is fixed to the world's center column; y eases toward the target.
      this.x = C.WORLD_W / 2;
      this.y += (targetY - this.y) * Math.min(1, C.CAMERA_LERP * dt);
      if (this.shakeT > 0) {
        this.shakeT = Math.max(0, this.shakeT - dt);
      }
    },

    shake: function (mag, dur) {
      this.shakeMag = mag;
      this.shakeT = dur;
      this.shakeDur = Math.max(dur, 0.0001);
    },

    // Current shake strength in 0..1 (linear decay).
    _strength: function () {
      if (this.shakeT <= 0) return 0;
      return this.shakeT / this.shakeDur;
    },

    getX: function () {
      if (this.shakeT <= 0) return this.x;
      var s = this._strength() * this.shakeMag;
      return this.x + ORB.M.rand(-1, 1) * s;
    },

    getY: function () {
      if (this.shakeT <= 0) return this.y;
      var s = this._strength() * this.shakeMag;
      return this.y + ORB.M.rand(-1, 1) * s;
    }
  };
})();
