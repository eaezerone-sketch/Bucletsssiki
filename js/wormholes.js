(function () {
  'use strict';
  var ORB = window.ORB = window.ORB || {};

  var RADIUS = 18;          // entry / exit trigger radius
  var COOLDOWN = 1;         // seconds before a pair can be used again
  var UP_BOOST = 80;        // extra upward speed after teleport (px/s)
  var EDGE_PAD = 30;        // keep ends at least this far from the world edges
  var END_GAP = 80;         // minimum distance between two wormhole ends
  var nextId = 0;

  function worldW() {
    return (ORB.CONFIG && ORB.CONFIG.WORLD_W) || 420;
  }

  // Radius around a planet that a wormhole must not enter.
  function avoidRadius(p) {
    var lr = p.latchRadius || ((p.orbitRadius || (p.radius || 20) + 26) + 30);
    return Math.max(lr, (p.radius || 0) * 1.5);
  }

  // True if (x, y) is inside the world, outside every latch zone and away from other ends.
  function fits(x, y) {
    var W = worldW();
    if (x < EDGE_PAD || x > W - EDGE_PAD) return false;
    var planets = (ORB.Planets && ORB.Planets.list) || [];
    for (var i = 0; i < planets.length; i++) {
      var p = planets[i];
      if (ORB.M.dist(x, y, p.x, p.y) < avoidRadius(p) + RADIUS + 10) return false;
    }
    var ends = ORB.Wormholes.list;
    for (var j = 0; j < ends.length; j++) {
      if (ORB.M.dist(x, y, ends[j].x, ends[j].y) < END_GAP) return false;
    }
    return true;
  }

  function makeEnd(x, y, isExit) {
    return {
      x: x, y: y, r: RADIUS, isExit: isExit, pair: null,
      phase: ORB.M.rand(0, Math.PI * 2), cooldown: 0, id: nextId++
    };
  }

  ORB.Wormholes = {
    list: [],

    reset: function () {
      ORB.Wormholes.list = [];
      nextId = 0;
    },

    // With diff.wormholeChance, place an entry in the gap between a and b (off to one side)
    // and its linked exit in the next gap above the upper planet.
    maybeSpawnBetween: function (a, b, diff) {
      if (!a || !b || !diff || !ORB.M.chance(diff.wormholeChance)) return;
      var upper = a.y <= b.y ? a : b;
      var lower = upper === a ? b : a;
      var W = worldW();
      var midX = (a.x + b.x) / 2;

      for (var tries = 0; tries < 12; tries++) {
        var side = Math.random() < 0.5 ? -1 : 1;
        var ex = ORB.M.clamp(midX + side * ORB.M.rand(70, 120), EDGE_PAD, W - EDGE_PAD);
        var ey = ORB.M.lerp(upper.y, lower.y, ORB.M.rand(0.35, 0.65));
        var xx = ORB.M.clamp(W - ex, EDGE_PAD, W - EDGE_PAD);
        var xy = upper.y - ORB.M.rand(160, 220);
        if (fits(ex, ey) && fits(xx, xy)) {
          var entry = makeEnd(ex, ey, false);
          var exit = makeEnd(xx, xy, true);
          entry.pair = exit;
          exit.pair = entry;
          ORB.Wormholes.list.push(entry, exit);
          return;
        }
      }
    },

    // Animate, count down cooldowns and teleport a flying player through an entry.
    // Returns { from, to } on teleport, otherwise null.
    update: function (dt, player) {
      var list = ORB.Wormholes.list;
      for (var i = 0; i < list.length; i++) {
        var w = list[i];
        w.phase += dt * 2;
        if (w.cooldown > 0) w.cooldown = Math.max(0, w.cooldown - dt);
      }
      if (!player || player.state !== 'fly') return null;

      for (var j = 0; j < list.length; j++) {
        var from = list[j];
        if (from.isExit || from.cooldown > 0 || !from.pair) continue;
        if (ORB.M.dist2(player.x, player.y, from.x, from.y) >= from.r * from.r) continue;

        var to = from.pair;
        player.x = to.x;
        player.y = to.y;
        player.vy -= UP_BOOST;                  // negative y is up
        player.speed = ORB.M.dist(0, 0, player.vx, player.vy);
        player.trail = [];                      // avoid a long streak across the map
        from.cooldown = COOLDOWN;
        to.cooldown = COOLDOWN;
        return { from: from, to: to };
      }
      return null;
    },

    // Remove pairs whose ends are both below the bottom edge of the view.
    prune: function (bottomY) {
      ORB.Wormholes.list = ORB.Wormholes.list.filter(function (w) {
        var highest = Math.min(w.y, w.pair ? w.pair.y : w.y);
        return highest <= bottomY;
      });
    }
  };
})();
