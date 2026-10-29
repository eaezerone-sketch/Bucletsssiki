(function () {
  'use strict';
  var ORB = window.ORB = window.ORB || {};

  var STAR_R = 9;
  var MAGNET_SPEED = 420;
  var ARC_BULGE = 40;     // max sideways bulge of the arc between a and b (px)
  var BOB_AMP = 3;        // vertical bob amplitude (px)
  var BOB_SPEED = 3;      // bob phase speed (rad/s)
  var BLACKHOLE_KILL_FACTOR = 1.4;

  // latch zone of a planet: latchRadius, fallback orbitRadius + 30
  function latchZone(p) {
    if (typeof p.latchRadius === 'number') return p.latchRadius;
    return (p.orbitRadius || 0) + 30;
  }

  // true if a circle at (x, y) with radius r touches any planet's latch zone
  // (blackholes have no latch, so their kill zone is avoided instead)
  function insideLatch(x, y, r) {
    var list = (ORB.Planets && ORB.Planets.list) || [];
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      var zone = latchZone(p);
      if (p.type === 'blackhole') {
        var kill = (p.radius || 0) * BLACKHOLE_KILL_FACTOR;
        if (kill > zone) zone = kill;
      }
      if (ORB.M.dist(x, y, p.x, p.y) < zone + r) return true;
    }
    return false;
  }

  ORB.Stars = {
    list: [],

    reset: function () {
      ORB.Stars.list = [];
    },

    // place 1-3 stars along a curved (quadratic) arc between planets a and b
    spawnBetween: function (a, b, diff) {
      var M = ORB.M;
      if (!a || !b) return;
      if (a.type === 'blackhole' || b.type === 'blackhole') return;
      if (!M.chance(diff.starChance)) return;

      var count = M.randInt(1, 3);
      // one bulge per arc: stars share the same curve
      var bulge = M.rand(-ARC_BULGE, ARC_BULGE);
      var dx = b.x - a.x;
      var dy = b.y - a.y;
      var len = Math.sqrt(dx * dx + dy * dy) || 1;
      var nx = -dy / len;   // unit normal of the segment
      var ny = dx / len;

      for (var i = 0; i < count; i++) {
        // a few tries to find a spot outside every latch zone
        for (var tries = 0; tries < 8; tries++) {
          var t = M.rand(0.3, 0.7);
          // quadratic bezier with control offset 2*bulge: peak offset = bulge at t = 0.5
          var off = 4 * t * (1 - t) * bulge;
          var x = M.lerp(a.x, b.x, t) + nx * off;
          var y = M.lerp(a.y, b.y, t) + ny * off;
          if (!insideLatch(x, y, STAR_R)) {
            ORB.Stars.list.push({
              x: x, y: y,
              baseX: x, baseY: y,
              r: STAR_R,
              phase: M.rand(0, Math.PI * 2),
              collected: false
            });
            break;
          }
        }
      }
    },

    // animate (bob), magnet pull (moves the base), collect; returns number collected this frame
    update: function (dt, player) {
      var M = ORB.M;
      var C = ORB.CONFIG;
      var list = ORB.Stars.list;
      var magnet = player.magnetTime > 0;
      var collected = 0;

      for (var i = 0; i < list.length; i++) {
        var s = list[i];
        s.phase += dt * BOB_SPEED;

        if (magnet) {
          var d = M.dist(s.x, s.y, player.x, player.y);
          if (d < C.MAGNET_RADIUS && d > 0) {
            var step = Math.min(d, MAGNET_SPEED * dt);
            s.baseX += (player.x - s.x) / d * step;
            s.baseY += (player.y - s.y) / d * step;
          }
        }

        // displayed position = base + bob
        s.x = s.baseX;
        s.y = s.baseY + Math.sin(s.phase) * BOB_AMP;

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
