(function () {
  'use strict';
  var ORB = window.ORB = window.ORB || {};

  var KINDS = ['shield', 'magnet', 'slow'];
  var RADIUS = 12;
  var MAGNET_SPEED = 420;

  // True if (x, y) is outside every planet orbit (with a small margin).
  function fits(x, y) {
    var list = ORB.Planets.list;
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (ORB.M.dist(x, y, p.x, p.y) < p.orbitRadius + RADIUS + 16) return false;
    }
    return true;
  }

  ORB.Powerups = {
    list: [],

    reset: function () {
      ORB.Powerups.list = [];
    },

    // With diff.powerChance, place one power-up near the midpoint of a and b.
    maybeSpawnBetween: function (a, b, diff) {
      if (!a || !b || !ORB.M.chance(diff.powerChance)) return;
      var mx = (a.x + b.x) / 2;
      var my = (a.y + b.y) / 2;
      for (var tries = 0; tries < 10; tries++) {
        var x = mx + ORB.M.rand(-40, 40);
        var y = my + ORB.M.rand(-40, 40);
        if (fits(x, y)) {
          ORB.Powerups.list.push({
            x: x, y: y, r: RADIUS,
            kind: ORB.M.pick(KINDS),
            phase: ORB.M.rand(0, Math.PI * 2),
            collected: false
          });
          return;
        }
      }
    },

    // Animate, magnet-pull, collect. Returns array of collected kinds this frame.
    update: function (dt, player) {
      var C = ORB.CONFIG;
      var magnet = !!(player && player.magnetTime > 0);
      var kinds = [];
      var kept = [];
      var list = ORB.Powerups.list;

      for (var i = 0; i < list.length; i++) {
        var p = list[i];
        p.phase += dt * 3;

        if (magnet) {
          var d = ORB.M.dist(p.x, p.y, player.x, player.y);
          if (d < C.MAGNET_RADIUS && d > 0) {
            var step = Math.min(d, MAGNET_SPEED * dt);
            p.x += (player.x - p.x) / d * step;
            p.y += (player.y - p.y) / d * step;
          }
        }

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
        return p.y <= bottomY;
      });
    }
  };
})();
