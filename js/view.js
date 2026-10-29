(function () {
  'use strict';
  var ORB = window.ORB = window.ORB || {};

  var canvas = null;
  var callbacks = [];

  function notify() {
    for (var i = 0; i < callbacks.length; i++) {
      callbacks[i](ORB.View);
    }
  }

  ORB.View = {
    cssW: 0,
    cssH: 0,
    dpr: 1,
    scale: 1,
    w: 0,
    h: 0,

    // Store the canvas, listen for viewport changes, and do the first resize.
    init: function (c) {
      canvas = c;
      var self = this;
      var onChange = function () { self.resize(); };
      window.addEventListener('resize', onChange);
      window.addEventListener('orientationchange', onChange);
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', onChange);
      }
      this.resize();
    },

    // Fit the canvas to its parent and recompute the world scale.
    resize: function () {
      if (!canvas) return;
      var parent = canvas.parentElement || canvas;
      this.cssW = parent.clientWidth || window.innerWidth || 1;
      this.cssH = parent.clientHeight || window.innerHeight || 1;
      this.dpr = Math.min(window.devicePixelRatio || 1, ORB.CONFIG.MAX_DPR);

      canvas.width = Math.round(this.cssW * this.dpr);
      canvas.height = Math.round(this.cssH * this.dpr);
      canvas.style.width = this.cssW + 'px';
      canvas.style.height = this.cssH + 'px';

      this.scale = Math.min(this.cssW / ORB.CONFIG.WORLD_W, this.cssH / ORB.CONFIG.MIN_VIEW_H);
      this.w = this.cssW / this.scale;
      this.h = this.cssH / this.scale;

      notify();
    },

    // Register a callback called after every resize.
    onResize: function (cb) {
      callbacks.push(cb);
    },

    // Map world coordinates to device pixels, centred on the camera.
    worldTransform: function (ctx, camX, camY) {
      var d = this.dpr * this.scale;
      ctx.setTransform(
        d, 0, 0, d,
        this.dpr * (this.cssW / 2 - camX * this.scale),
        this.dpr * (this.cssH / 2 - camY * this.scale)
      );
    },

    // Map CSS pixels to device pixels (for screen-space drawing).
    screenTransform: function (ctx) {
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }
  };
})();
