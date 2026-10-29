(function () {
  'use strict';
  var ORB = window.ORB = window.ORB || {};

  var MAX_ALIVE = 2;
  var TAIL_LEN = 18;
  var COMET_R = 7;

  // Append the comet's current position to its tail, reusing the oldest
  // point object once the tail is full (no per-frame allocation).
  function pushTail(c) {
    var t = c.tail.length >= TAIL_LEN ? c.tail.shift() : { x: 0, y: 0 };
    t.x = c.x;
    t.y = c.y;
    c.tail.push(t);
  }

  var Comets = {
    list: [],

    reset: function () {
      Comets.list = [];
    },

    // Spawn a comet entering from the top-left or top-right corner, moving
    // diagonally down and across the screen.
    maybeSpawn: function (dt, camY, viewW, viewH, diff) {
      var C = ORB.CONFIG, M = ORB.M;
      if (Comets.list.length >= MAX_ALIVE) return;
      if (!M.chance(diff.cometRate * dt)) return;

      var side = M.chance(0.5) ? -1 : 1; // -1 = left corner, 1 = right corner
      var speed = M.rand(260, 380);
      var angle = M.rand(0.5, 0.9); // radians below horizontal

      Comets.list.push({
        x: C.WORLD_W / 2 + side * (viewW / 2 + 30),
        y: camY - viewH / 2 - 30,
        vx: -side * speed * Math.cos(angle), // moving inward
        vy: speed * Math.sin(angle),
        r: COMET_R,
        tail: [],   // last TAIL_LEN positions, newest last
        used: false
      });
    },

    // Move comets and record their tails. Returns the first not-yet-ridden
    // comet the flying player touches (marked used), otherwise null.
    update: function (dt, player) {
      var M = ORB.M, C = ORB.CONFIG;
      var list = Comets.list;
      var i, c;

      for (i = 0; i < list.length; i++) {
        c = list[i];
        c.x += c.vx * dt;
        c.y += c.vy * dt;
        pushTail(c);
      }

      if (!player || player.state !== 'fly') return null;

      for (i = 0; i < list.length; i++) {
        c = list[i];
        if (!c.used && M.circleHit(player.x, player.y, C.PLAYER_RADIUS,
                                   c.x, c.y, c.r + 10)) {
          c.used = true;
          return c;
        }
      }
      return null;
    },

    // Remove comets far below the view or that have left through the side
    // they were moving toward. In-place filter (no new array per call).
    prune: function (bottomY, viewW) {
      var C = ORB.CONFIG;
      var centerX = C.WORLD_W / 2;
      var half = viewW / 2 + 120;
      var list = Comets.list;
      var w = 0;

      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        var below = c.y - c.r > bottomY;
        var offSide = (c.vx > 0 && c.x - centerX > half) ||
                      (c.vx < 0 && centerX - c.x > half);
        if (!below && !offSide) list[w++] = c;
      }
      list.length = w;
    }
  };

  ORB.Comets = Comets;
})();
