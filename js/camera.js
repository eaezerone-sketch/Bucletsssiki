(function () {
  'use strict';
  var ORB = window.ORB = window.ORB || {};

  // Smoothed 2D camera with zoom and a decaying random screen shake.
  // y follows CAMERA_LERP, x follows at half that rate, zoom eases with rate 2.
  ORB.Camera = {
    x: 0,
    y: 0,
    zoom: 1,
    shakeT: 0,     // seconds of shake left
    shakeMag: 0,   // max shake offset in world px
    shakeDur: 0,   // total shake duration (for decay)
    _ox: 0,        // current shake offset (recomputed each update)
    _oy: 0,

    reset: function (x, y) {
      this.x = x;
      this.y = y;
      this.zoom = 1;
      this.shakeT = 0;
      this.shakeMag = 0;
      this.shakeDur = 0;
      this._ox = 0;
      this._oy = 0;
    },

    // New form: update(dt, targetX, targetY, targetZoom).
    // v1 form:  update(dt, targetY) -> targetX = WORLD_W/2, targetZoom = 1.
    update: function (dt, targetX, targetY, targetZoom) {
      var C = ORB.CONFIG;
      if (arguments.length < 3) {
        targetY = targetX;
        targetX = C.WORLD_W / 2;
        targetZoom = 1;
      } else if (targetZoom === undefined) {
        targetZoom = 1;
      }

      var kY = Math.min(1, C.CAMERA_LERP * dt);
      var kX = Math.min(1, C.CAMERA_LERP * 0.5 * dt);
      var kZ = Math.min(1, 2 * dt);
      this.x += (targetX - this.x) * kX;
      this.y += (targetY - this.y) * kY;
      this.zoom += (targetZoom - this.zoom) * kZ;

      if (this.shakeT > 0) {
        this.shakeT = Math.max(0, this.shakeT - dt);
      }
      this._updateShake();
    },

    shake: function (mag, dur) {
      this.shakeMag = mag;
      this.shakeT = dur;
      this.shakeDur = Math.max(dur, 0.0001);
      this._updateShake();
    },

    // Current shake strength in 0..1 (linear decay).
    _strength: function () {
      if (this.shakeT <= 0) return 0;
      return this.shakeT / this.shakeDur;
    },

    // Random offset scaled by the remaining shake strength.
    _updateShake: function () {
      if (this.shakeT <= 0) {
        this._ox = 0;
        this._oy = 0;
        return;
      }
      var s = this._strength() * this.shakeMag;
      this._ox = ORB.M.rand(-1, 1) * s;
      this._oy = ORB.M.rand(-1, 1) * s;
    },

    getX: function () {
      return this.x + this._ox;
    },

    getY: function () {
      return this.y + this._oy;
    },

    getZoom: function () {
      return this.zoom;
    }
  };
})();
