(function () {
  'use strict';
  var ORB = window.ORB = window.ORB || {};

  var STAR_R = 9;
  var MAGNET_SPEED = 420;
  var ORBIT_MARGIN = 6;

  // true if a circle at (x, y) with radius r touches any planet orbit
  function insideOrbit(x, y, r) {
    var list = (ORB.Planets && ORB.Planets.list) || [];
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (ORB.M.dist(x, y, p.x, p.y) < p.orbitRadius + r + ORBIT_MARGIN) return true;
    }
    return false;
  }

  ORB.Stars = {
    list: [],

    reset: function () {
      ORB.Stars.list = [];
    },

    // place 1-3 stars on the segment between planets a and b
    spawnBetween: function (a, b, diff) {
      var M = ORB.M;
      if (!M.chance(diff.starChance)) return;
      var count = M.randInt(1, 3);
      for (var i = 0; i < count; i++) {
        // a few tries to find a spot outside all orbits
        for (var tries = 0; tries < 8; tries++) {
          var t = M.rand(0.35, 0.65);
          var x = M.lerp(a.x, b.x, t) + M.rand(-30, 30);
          var y = M.lerp(a.y, b.y, t);
          if (!insideOrbit(x, y, STAR_R)) {
            ORB.Stars.list.push({ x: x, y: y, r: STAR_R, phase: M.rand(0, Math.PI * 2), collected: false });
            break;
          }
        }
      }
    },

    // animate, magnet pull, collect; returns number collected this frame
    update: function (dt, player) {
      var M = ORB.M;
      var C = ORB.CONFIG;
      var list = ORB.Stars.list;
      var magnet = player.magnetTime > 0;
      var collected = 0;

      for (var i = 0; i < list.length; i++) {
        var s = list[i];
        s.phase += dt * 3;

        if (magnet) {
          var d = M.dist(s.x, s.y, player.x, player.y);
          if (d < C.MAGNET_RADIUS && d > 0) {
            var step = Math.min(d, MAGNET_SPEED * dt);
            s.x += (player.x - s.x) / d * step;
            s.y += (player.y - s.y) / d * step;
          }
        }

        if (M.circleHit(player.x, player.y, C.PLAYER_RADIUS, s.x, s.y, s.r)) {
          s.collected = true;
        }
      }

      // remove collected stars in place
      for (var j = list.length - 1; j >= 0; j--) {
        if (list[j].collected) {
          list.splice(j, 1);
          collected++;
        }
      }
      return collected;
    },

    // remove stars below the visible/bottom limit
    prune: function (bottomY) {
      var list = ORB.Stars.list;
      for (var i = list.length - 1; i >= 0; i--) {
        if (list[i].y > bottomY) list.splice(i, 1);
      }
    }
  };
})();
