(function () {
  'use strict';
  var ORB = window.ORB = window.ORB || {};

  var KINDS = ['shield', 'magnet', 'slow'];
  var RADIUS = 12;
  var MAGNET_SPEED = 420;
  var BOB_AMP = 3;      // gentle vertical bob, like stars
  var BOB_SPEED = 3;    // phase rad/s
  var LATCH_FALLBACK_PAD = 30;

  // True if (x, y) is outside every planet's latch zone, with margins for
  // the bob, the power-up radius and any planet drift (moveAmp).
  function fits(x, y) {
    var list = ORB.Planets.list;
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      var px = p.baseX !== undefined ? p.baseX : p.x;
      var latch = p.latchRadius || (p.orbitRadius + LATCH_FALLBACK_PAD);
      var reach = latch + RADIUS + BOB_AMP + (p.moveAmp || 0) + 2;
      if (ORB.M.dist(x, y, px, p.y) < reach) return false;
    }
    return true;
  }

  ORB.Powerups = {
    list: [],

    reset: function () {
      ORB.Powerups.list = [];
    },

    // With diff.powerChance, place one power-up near the midpoint of a and b.
    // Never placed between a blackhole and anything else.
    maybeSpawnBetween: function (a, b, diff) {
      if (!a || !b) return;
      if (a.type === 'blackhole' || b.type === 'blackhole') return;
      if (!ORB.M.chance(diff.powerChance)) return;
      var mx = (a.x + b.x) / 2;
      var my = (a.y + b.y) / 2;
      for (var tries = 0; tries < 10; tries++) {
        var x = mx + ORB.M.rand(-40, 40);
        var y = my + ORB.M.rand(-40, 40);
        if (fits(x, y)) {
          ORB.Powerups.list.push({
            x: x, y: y, r: RADIUS,
            baseX: x, baseY: y,          // bob is applied around the base position
            kind: ORB.M.pick(KINDS),
            phase: ORB.M.rand(0, Math.PI * 2),
            collected: false
          });
          return;
        }
      }
    },

    // Animate, magnet-pull (moves the base position), collect.
    // Returns array of collected kinds this frame.
    update: function (dt, player) {
      var C = ORB.CONFIG;
      var magnet = !!(player && player.magnetTime > 0);
      var kinds = [];
      var kept = [];
      var list = ORB.Powerups.list;

      for (var i = 0; i < list.length; i++) {
        var p = list[i];
        p.phase += dt * BOB_SPEED;

        if (magnet) {
          var d = ORB.M.dist(p.baseX, p.baseY, player.x, player.y);
          if (d < C.MAGNET_RADIUS && d > 0) {
            var step = Math.min(d, MAGNET_SPEED * dt);
            p.baseX += (player.x - p.baseX) / d * step;
            p.baseY += (player.y - p.baseY) / d * step;
          }
        }

        p.x = p.baseX;
        p.y = p.baseY + Math.sin(p.phase) * BOB_AMP;

        if (player && ORB.M.circleHit(player.x, player.y, C.PLAYER_RADIUS, p.x, p.y, p.r)) {
          p.collected = true;
          kinds.push(p.kind);
        } else {
          kept.push(p);
        }
      }

      ORB.Powerups.list = kept;
      return kinds;
    },

    // Remove power-ups below the bottom edge of the view.
    prune: function (bottomY) {
      ORB.Powerups.list = ORB.Powerups.list.filter(function (p) {
        return p.baseY <= bottomY;
      });
    }
  };
})();
