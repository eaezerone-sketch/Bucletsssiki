(function () {
  'use strict';
  var ORB = window.ORB = window.ORB || {};

  var MAX_ALIVE = 6;
  var lastViewW = 0; // visible world width from the latest maybeSpawn

  var A = {
    list: [],

    reset: function () {
      A.list = [];
      lastViewW = 0;
    },

    // Spawn one asteroid just outside the left or right edge of the view.
    maybeSpawn: function (dt, camY, viewW, viewH, diff) {
      var C = ORB.CONFIG, M = ORB.M;
      lastViewW = viewW;
      if (A.list.length >= MAX_ALIVE) return;
      if (!M.chance(diff.asteroidRate * dt)) return;

      var fromLeft = M.chance(0.5);
      var side = fromLeft ? -1 : 1;
      var verts = [];
      var n = M.randInt(9, 12);
      for (var i = 0; i < n; i++) verts.push(M.rand(0.7, 1.2));

      A.list.push({
        x: C.WORLD_W / 2 + side * (viewW / 2 + 40),
        y: M.rand(camY - viewH * 0.45, camY + viewH * 0.15),
        vx: -side * M.rand(50, 120), // moving inward
        vy: M.rand(-20, 20),
        r: M.rand(10, 20),
        rot: M.rand(0, Math.PI * 2),
        rotSpeed: M.rand(-1.5, 1.5),
        verts: verts
      });
    },

    // Move and rotate; remove far-outside asteroids. Returns the asteroid
    // hitting the player, or null.
    update: function (dt, player) {
      var C = ORB.CONFIG, M = ORB.M;
      var hit = null;
      var centerX = C.WORLD_W / 2;
      var keep = [];

      for (var i = 0; i < A.list.length; i++) {
        var a = A.list[i];
        a.x += a.vx * dt;
        a.y += a.vy * dt;
        a.rot += a.rotSpeed * dt;

        if (!hit && M.circleHit(player.x, player.y, C.PLAYER_RADIUS,
                                a.x, a.y, a.r * 0.85)) {
          hit = a;
        }
        if (Math.abs(a.x - centerX) <= lastViewW) keep.push(a);
      }
      A.list = keep;
      return hit;
    },

    destroy: function (a) {
      var idx = A.list.indexOf(a);
      if (idx !== -1) A.list.splice(idx, 1);
    },

    prune: function (bottomY) {
      A.list = A.list.filter(function (a) {
        return a.y - a.r <= bottomY;
      });
    }
  };

  ORB.Asteroids = A;
})();
