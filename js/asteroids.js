(function () {
  'use strict';
  var ORB = window.ORB = window.ORB || {};

  var MAX_ALIVE = 6;
  var GRAVITY_SCALE = 0.35;    // asteroids feel 35% of planet gravity
  var NEAR_MISS_PAD = 22;      // near-miss band beyond r
  var lastViewW = 0; // visible world width from the latest maybeSpawn
  var nearArr = [];  // reused return array for nearMiss

  var A = {
    list: [],

    reset: function () {
      A.list = [];
      nearArr.length = 0;
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
        verts: verts,
        missed: false // set once when it passes the player closely
      });
    },

    // Move, bend by planet gravity, rotate; destroy asteroids that hit a
    // planet body; remove far-outside asteroids. Returns the asteroid
    // hitting the player, or null.
    update: function (dt, player) {
      var C = ORB.CONFIG, M = ORB.M;
      var hit = null;
      var centerX = C.WORLD_W / 2;
      var keep = [];
      var planets = (ORB.Planets && ORB.Planets.list) || null;
      var hasGravity = !!(ORB.Physics && ORB.Physics.gravity);

      for (var i = 0; i < A.list.length; i++) {
        var a = A.list[i];

        if (hasGravity && planets) {
          var g = ORB.Physics.gravity(a.x, a.y, planets, null);
          a.vx += g.ax * GRAVITY_SCALE * dt;
          a.vy += g.ay * GRAVITY_SCALE * dt;
        }

        a.x += a.vx * dt;
        a.y += a.vy * dt;
        a.rot += a.rotSpeed * dt;

        // Hitting a planet body (or a black hole, which is a planet) destroys it.
        var destroyed = false;
        if (planets) {
          for (var p = 0; p < planets.length; p++) {
            var pl = planets[p];
            if (pl.dead) continue;
            if (M.circleHit(a.x, a.y, a.r, pl.x, pl.y, pl.radius)) {
              destroyed = true;
              break;
            }
          }
        }
        if (destroyed) {
          if (ORB.Particles && ORB.Particles.debris) {
            ORB.Particles.debris(a.x, a.y, '#a89a8a', 8);
          } else if (ORB.Particles && ORB.Particles.burst) {
            ORB.Particles.burst(a.x, a.y, '#a89a8a', 8, 120, 0.6);
          }
          continue;
        }

        if (!hit && M.circleHit(player.x, player.y, C.PLAYER_RADIUS,
                                a.x, a.y, a.r * 0.85)) {
          hit = a;
        }
        if (Math.abs(a.x - centerX) <= lastViewW) keep.push(a);
      }
      A.list = keep;
      return hit;
    },

    // Asteroids that passed within r + 22 of the player this frame without
    // hitting it. Each asteroid is returned only once (flag `missed`).
    // The returned array is reused: consume it before the next call.
    nearMiss: function (player) {
      var C = ORB.CONFIG, M = ORB.M;
      nearArr.length = 0;
      if (!player) return nearArr;

      for (var i = 0; i < A.list.length; i++) {
        var a = A.list[i];
        if (a.missed) continue;
        if (M.dist(player.x, player.y, a.x, a.y) >= a.r + NEAR_MISS_PAD) continue;
        if (M.circleHit(player.x, player.y, C.PLAYER_RADIUS,
                        a.x, a.y, a.r * 0.85)) continue; // a hit, not a miss
        a.missed = true;
        nearArr.push(a);
      }
      return nearArr;
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
