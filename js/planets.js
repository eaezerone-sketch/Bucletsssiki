(function () {
  'use strict';
  var ORB = window.ORB = window.ORB || {};

  var nextId = 0;

  function newPlanet(x, y, radius) {
    nextId++;
    return {
      id: nextId,
      x: x,
      y: y,
      baseX: x,
      radius: radius,
      orbitRadius: radius + ORB.CONFIG.ORBIT_GAP,
      hue: 0,
      angularSpeed: 0,
      moveAmp: 0,
      moveSpeed: 0,
      movePhase: 0,
      visited: false,
      ringed: false
    };
  }

  ORB.Planets = {
    list: [],

    // Clears the list and creates the first (static, visited) planet.
    reset: function () {
      var M = ORB.M;
      var C = ORB.CONFIG;
      nextId = 0;
      this.list = [];
      var p = newPlanet(C.WORLD_W / 2, 0, 30);
      p.hue = M.rand(0, 360);
      p.angularSpeed = 1.7;
      p.visited = true;
      this.list.push(p);
    },

    // Creates planets above the highest one until it reaches topY.
    // Returns the array of newly created planets.
    ensure: function (topY, diff) {
      var M = ORB.M;
      var C = ORB.CONFIG;
      var created = [];

      while (this.list.length && this.highest().y > topY) {
        var prev = this.highest();
        var y = prev.y - M.rand(diff.gapMin, diff.gapMax);
        var radius = M.rand(diff.radiusMin, diff.radiusMax);
        var p = newPlanet(0, y, radius);
        var or = p.orbitRadius;

        // Pick x, retrying so the planet is not too close to the previous one.
        var minX = or + 12;
        var maxX = C.WORLD_W - or - 12;
        var x = M.rand(minX, maxX);
        for (var i = 0; i < 10; i++) {
          var cand = M.rand(minX, maxX);
          var far = M.dist(cand, y, prev.x, prev.y) >= prev.orbitRadius + or + 50;
          var wide = Math.abs(cand - prev.x) >= 40;
          x = cand;
          if (far && wide) break;
        }
        p.baseX = x;
        p.x = x;

        // Moving planets oscillate horizontally, kept inside the world width.
        if (M.chance(diff.moveChance)) {
          var maxAmp = Math.max(0, Math.min(x - or, C.WORLD_W - x - or));
          p.moveAmp = Math.min(M.rand(diff.moveAmpMin, diff.moveAmpMax), maxAmp);
          p.moveSpeed = M.rand(0.6, 1.4);
          p.movePhase = M.rand(0, Math.PI * 2);
          p.x = p.baseX + Math.sin(p.movePhase) * p.moveAmp;
        }

        p.angularSpeed = diff.angularSpeed * M.rand(0.9, 1.1);
        p.hue = M.rand(0, 360);
        p.ringed = M.chance(0.3);
        p.visited = false;

        this.list.push(p);
        created.push(p);
      }
      return created;
    },

    // Advances the horizontal motion of moving planets.
    update: function (dt) {
      var M = ORB.M;
      for (var i = 0; i < this.list.length; i++) {
        var p = this.list[i];
        if (p.moveAmp > 0) {
          p.movePhase += p.moveSpeed * dt;
          p.x = p.baseX + Math.sin(p.movePhase) * p.moveAmp;
        }
      }
    },

    // Removes planets that are fully below bottomY (in place, keeps array identity).
    prune: function (bottomY) {
      var keep = 0;
      for (var i = 0; i < this.list.length; i++) {
        var p = this.list[i];
        if (!(p.y - p.orbitRadius > bottomY)) {
          this.list[keep++] = p;
        }
      }
      this.list.length = keep;
    },

    // First planet (not exclude) whose capture zone contains (x, y), or null.
    findCapture: function (x, y, exclude) {
      var M = ORB.M;
      var C = ORB.CONFIG;
      for (var i = 0; i < this.list.length; i++) {
        var p = this.list[i];
        if (p === exclude) continue;
        if (M.dist(x, y, p.x, p.y) < p.orbitRadius + C.CAPTURE_PAD) return p;
      }
      return null;
    },

    // Most recently created (highest) planet.
    highest: function () {
      return this.list[this.list.length - 1];
    }
  };
})();
