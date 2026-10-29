(function () {
  'use strict';
  var ORB = window.ORB = window.ORB || {};

  var nextId = 0;
  // Chain planets created since the last blackhole (blackholes need >= 3).
  var sinceBlackhole = 3;
  var TWO_PI = Math.PI * 2;

  // Type table: radius multiplier, gravity mass, orbit speed multiplier, tether stiffness.
  var TYPES = {
    rocky:   { rMul: 1.0,  mass: 1.0, spd: 1.0,  tetherK: 1.0 },
    ice:     { rMul: 0.9,  mass: 0.8, spd: 1.35, tetherK: 1.0 },
    gas:     { rMul: 1.25, mass: 1.7, spd: 0.8,  tetherK: 1.0 },
    lava:    { rMul: 1.0,  mass: 1.1, spd: 1.05, tetherK: 1.0 },
    jelly:   { rMul: 1.0,  mass: 1.0, spd: 1.0,  tetherK: 0.5 },
    star:    { rMul: 1.15, mass: 1.4, spd: 1.0,  tetherK: 1.0 },
    crumble: { rMul: 0.85, mass: 0.9, spd: 1.0,  tetherK: 1.0 }
  };
  var TYPE_ORDER = ['rocky', 'ice', 'gas', 'lava', 'jelly', 'star', 'crumble'];
  var weightScratch = [0, 0, 0, 0, 0, 0, 0];
  var eaten = []; // reused result of consume()

  // CONFIG value read at call time with a fallback.
  function cfg(key, fallback) {
    var C = ORB.CONFIG;
    var v = C ? C[key] : undefined;
    return typeof v === 'number' && isFinite(v) ? v : fallback;
  }

  function num(v, fallback) {
    return typeof v === 'number' && isFinite(v) ? v : fallback;
  }

  function rand(a, b) {
    return a + Math.random() * (b - a);
  }

  function randSign() {
    return Math.random() < 0.5 ? -1 : 1;
  }

  // latchRadius for a given orbit radius.
  function latchFor(or) {
    return or + Math.max(cfg('LATCH_PAD_MIN', 22), or * cfg('LATCH_PAD_FACTOR', 0.55));
  }

  // Blank planet with every Planet field initialised.
  function newPlanet(type, x, y, radius) {
    nextId++;
    var T = TYPES[type];
    var or = radius + cfg('ORBIT_GAP', 26);
    return {
      id: nextId,
      type: type,
      x: x,
      y: y,
      baseX: x,
      vx: 0,
      vy: 0,
      radius: radius,
      orbitRadius: or,
      latchRadius: latchFor(or),
      gravityRadius: or * cfg('GRAVITY_RADIUS_FACTOR', 2.8),
      mass: T ? T.mass : 1,
      tetherK: T ? T.tetherK : 1,
      hue: 0,
      angularSpeed: 0,
      spin: randSign() * rand(0.15, 0.5),
      rot: rand(0, TWO_PI),
      moveAmp: 0,
      moveSpeed: 0,
      movePhase: 0,
      visited: false,
      ringed: false,
      ringTilt: rand(0.25, 0.45),
      moons: [],
      wobble: 0,
      wobbleV: 0,
      wobbleAngle: 0,
      ripple: 0,
      ripplePhase: 0,
      seed: Math.floor(Math.random() * 1e9),
      heat: 0,
      crumble: -1,
      dead: false,
      deadT: 0,
      age: 0
    };
  }

  function hueFor(type) {
    switch (type) {
      case 'ice': return rand(175, 215);
      case 'lava': return rand(0, 28);
      case 'jelly': return rand(270, 340);
      case 'star': return rand(38, 55);
      case 'crumble': return rand(20, 40);
      default: return rand(0, 360);
    }
  }

  function addMoons(p, count) {
    for (var i = 0; i < count; i++) {
      p.moons.push({
        dist: p.radius + rand(10, 22),
        angle: rand(0, TWO_PI),
        speed: randSign() * rand(0.6, 1.6),
        r: rand(2, 4.5),
        hue: rand(0, 360)
      });
    }
  }

  function moonCount(type) {
    switch (type) {
      case 'rocky': return Math.floor(rand(0, 3));
      case 'gas': return Math.floor(rand(0, 4));
      case 'ice':
      case 'lava': return Math.random() < 0.25 ? 1 : 0;
      default: return 0;
    }
  }

  function ringChance(type) {
    if (type === 'gas') return 0.7;
    if (type === 'ice') return 0.15;
    if (type === 'rocky') return 0.1;
    return 0;
  }

  // Weighted type pick; never two star or two crumble in a row.
  function pickType(prevType, weights) {
    var total = 0;
    var i;
    for (i = 0; i < TYPE_ORDER.length; i++) {
      var k = TYPE_ORDER[i];
      var w = weights ? weights[k] : (k === 'rocky' ? 1 : 0);
      w = num(w, 0);
      if (w < 0) w = 0;
      if ((k === 'star' || k === 'crumble') && k === prevType) w = 0;
      weightScratch[i] = w;
      total += w;
    }
    if (!(total > 0)) return 'rocky';
    var r = Math.random() * total;
    for (i = 0; i < TYPE_ORDER.length; i++) {
      r -= weightScratch[i];
      if (r < 0 && weightScratch[i] > 0) return TYPE_ORDER[i];
    }
    return 'rocky';
  }

  // Try to build a chain planet above prev. Returns null when no legal x exists
  // (unless `forced`, which uses the safest parameters and always returns a planet).
  function tryPlace(prev, type, diff, forced) {
    var W = cfg('WORLD_W', 420);
    var gapMin = num(diff.gapMin, 150);
    var gapMax = Math.max(gapMin, num(diff.gapMax, gapMin + 70));
    var radMin = num(diff.radiusMin, 18);
    var radMax = Math.max(radMin, num(diff.radiusMax, 34));
    var T = TYPES[type];

    var dy = forced ? gapMax : rand(gapMin, gapMax);
    var radius = (forced ? radMin : rand(radMin, radMax)) * T.rMul;
    var p = newPlanet(type, 0, prev.y - dy, radius);
    var or = p.orbitRadius;

    // Horizontal motion amplitude, kept inside the world.
    var minX = or + 12;
    var maxX = Math.max(minX, W - or - 12);
    var amp = 0;
    if (!forced && Math.random() < num(diff.moveChance, 0)) {
      amp = rand(num(diff.moveAmpMin, 25), Math.max(num(diff.moveAmpMin, 25), num(diff.moveAmpMax, 60)));
      amp = Math.min(amp, (maxX - minX) / 2);
      if (amp < 8) amp = 0;
    }
    if (forced && prev.moveAmp > 0) {
      prev.moveAmp = 0;
      prev.x = prev.baseX;
    }
    var lo = minX + amp;
    var hi = maxX - amp;

    // Latch zones must not overlap even at the closest point of both motions.
    var need = prev.latchRadius + p.latchRadius + 20;
    var dxFlat = need > dy ? Math.sqrt(need * need - dy * dy) : 0;
    var dxMin = Math.max(40, dxFlat) + prev.moveAmp + amp;
    var pbx = prev.baseX;

    var lenL = (pbx - dxMin) - lo;
    var lenR = hi - (pbx + dxMin);
    var x;
    if (lenL < 0 && lenR < 0) {
      if (!forced) return null;
      x = pbx < W / 2 ? hi : lo; // absurd parameters: best effort
    } else if (lenL >= 0 && (lenR < 0 || Math.random() < lenL / (lenL + lenR))) {
      x = lo + Math.random() * lenL;
    } else {
      x = pbx + dxMin + Math.random() * lenR;
    }

    p.baseX = x;
    p.x = x;
    if (amp > 0) {
      p.moveAmp = amp;
      p.moveSpeed = rand(0.6, 1.4);
      p.movePhase = rand(0, TWO_PI);
      p.x = x + Math.sin(p.movePhase) * amp;
    }

    p.angularSpeed = num(diff.angularSpeed, 1.7) * rand(0.9, 1.1) * T.spd;
    p.hue = hueFor(type);
    p.ringed = Math.random() < ringChance(type);
    addMoons(p, moonCount(type));
    return p;
  }

  // Distance from point (x, y) to the horizontal motion segment of planet q.
  function distToExtent(q, x, y) {
    var lo = q.baseX - q.moveAmp;
    var hi = q.baseX + q.moveAmp;
    var dx = x < lo ? lo - x : (x > hi ? x - hi : 0);
    var dy = y - q.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // Build a blackhole in the gap between prev and next, or null if there is no room.
  function tryBlackhole(prev, next) {
    var W = cfg('WORLD_W', 420);
    var loE = Math.min(prev.baseX - prev.moveAmp, next.baseX - next.moveAmp);
    var hiE = Math.max(prev.baseX + prev.moveAmp, next.baseX + next.moveAmp);
    var leftRoom = (loE - 90) - 50;
    var rightRoom = (W - 50) - (hiE + 90);
    if (leftRoom < 0 && rightRoom < 0) return null;
    var useLeft = leftRoom > rightRoom; // side with more room
    var radius = rand(14, 18);
    for (var i = 0; i < 6; i++) {
      var x = useLeft ? 50 + Math.random() * leftRoom : hiE + 90 + Math.random() * rightRoom;
      var y = next.y + (prev.y - next.y) * rand(0.35, 0.65);
      if (distToExtent(prev, x, y) < prev.latchRadius + radius + 12) continue;
      if (distToExtent(next, x, y) < next.latchRadius + radius + 12) continue;
      var b = newPlanet('blackhole', x, y, radius);
      b.orbitRadius = radius;
      b.latchRadius = 0;
      b.gravityRadius = 230;
      b.mass = 1.2; // strong enough to slingshot, weak enough to survive a ~45 px pass
      b.tetherK = 0;
      b.angularSpeed = 0;
      b.spin = randSign() * rand(0.4, 0.9);
      b.hue = rand(260, 300);
      b.killRadius = radius * cfg('BLACKHOLE_KILL_FACTOR', 1.4);
      return b;
    }
    return null;
  }

  ORB.Planets = {
    list: [],

    // Clears the list and creates the first (static, visited) planet.
    reset: function () {
      nextId = 0;
      sinceBlackhole = 3;
      this.list = [];
      var p = newPlanet('rocky', cfg('WORLD_W', 420) / 2, 0, 30);
      p.hue = rand(0, 360);
      p.angularSpeed = 1.7;
      p.visited = true;
      addMoons(p, 1);
      this.list.push(p);
    },

    // Creates planets above the highest one until it reaches topY.
    // Returns the array of newly created planets (blackholes included, in y order).
    ensure: function (topY, diff) {
      var created = [];
      diff = diff || {};
      if (!this.list.length) return created;

      while (this.highest().y > topY) {
        var prev = this.highest();
        var type = pickType(prev.type, diff.typeWeights);
        var p = null;
        for (var i = 0; i < 8 && !p; i++) p = tryPlace(prev, type, diff, false);
        if (!p) p = tryPlace(prev, type, diff, true);

        // Optionally add a blackhole in the gap (never counts as a chain planet).
        if (sinceBlackhole >= 3 && Math.random() < num(diff.blackholeChance, 0)) {
          var b = tryBlackhole(prev, p);
          if (b) {
            this.list.push(b);
            created.push(b);
            sinceBlackhole = 0;
          }
        }
        sinceBlackhole++;

        this.list.push(p);
        created.push(p);
      }
      return created;
    },

    // Advances motion, rotation, moons, wobble springs, ripples and crumbling.
    update: function (dt) {
      if (!(dt > 0)) return;
      var sdt = Math.min(dt, 0.05); // keeps the wobble spring stable
      var decay = Math.exp(-1.6 * dt);
      var list = this.list;
      for (var i = 0; i < list.length; i++) {
        var p = list[i];
        if (p.dead) {
          p.deadT += dt;
          continue;
        }
        p.age += dt;

        // Horizontal oscillation; remember the planet's own velocity.
        if (p.moveAmp > 0) {
          var oldX = p.x;
          p.movePhase += p.moveSpeed * dt;
          p.x = p.baseX + Math.sin(p.movePhase) * p.moveAmp;
          p.vx = (p.x - oldX) / dt;
        } else {
          p.vx = 0;
        }
        p.vy = 0;

        p.rot += p.spin * dt;
        for (var m = 0; m < p.moons.length; m++) {
          var moon = p.moons[m];
          moon.angle += moon.speed * dt;
        }

        // Squash-and-stretch spring.
        var jelly = p.type === 'jelly';
        var k = jelly ? 90 : 180;
        var damp = jelly ? 4 : 9;
        p.wobbleV += (-k * p.wobble - damp * p.wobbleV) * sdt;
        p.wobble += p.wobbleV * sdt;
        if (p.wobble > 0.3) { p.wobble = 0.3; if (p.wobbleV > 0) p.wobbleV = 0; }
        else if (p.wobble < -0.3) { p.wobble = -0.3; if (p.wobbleV < 0) p.wobbleV = 0; }

        p.ripple *= decay;
        p.ripplePhase += 7 * dt;

        if (p.crumble >= 0) {
          p.crumble += dt / cfg('CRUMBLE_TIME', 2.2);
          if (p.crumble >= 1) {
            p.crumble = 1;
            p.dead = true;
            p.deadT = 0;
          }
        }
      }
    },

    // Planet reacts to a ship landing on it (strength 0..1, angle = impact direction).
    impact: function (p, strength, angle) {
      if (!p) return;
      var s = Math.max(0, Math.min(1, num(strength, 0)));
      p.wobbleV += 2.4 * s * (p.type === 'jelly' ? 2 : 1);
      p.wobbleAngle = num(angle, 0);
      p.ripple = Math.max(p.ripple, s);
    },

    // Begin crumbling (called when a ship latches onto a crumble planet).
    startCrumble: function (p) {
      if (p && p.crumble < 0) p.crumble = 0;
    },

    // First latchable planet (not ignore, not dead, not blackhole) whose latch zone holds (x, y).
    findLatch: function (x, y, ignore) {
      var list = this.list;
      for (var i = 0; i < list.length; i++) {
        var p = list[i];
        if (p === ignore || p.dead || p.type === 'blackhole') continue;
        var dx = x - p.x, dy = y - p.y;
        if (dx * dx + dy * dy < p.latchRadius * p.latchRadius) return p;
      }
      return null;
    },

    // Blackhole whose kill radius contains (x, y), or null.
    blackholeKill: function (x, y) {
      var f = cfg('BLACKHOLE_KILL_FACTOR', 1.4);
      var list = this.list;
      for (var i = 0; i < list.length; i++) {
        var p = list[i];
        if (p.type !== 'blackhole' || p.dead) continue;
        var kr = p.radius * f;
        var dx = x - p.x, dy = y - p.y;
        if (dx * dx + dy * dy < kr * kr) return p;
      }
      return null;
    },

    // Removes planets far below bottomY and long-dead ones (in place).
    prune: function (bottomY) {
      var list = this.list;
      var keep = 0;
      for (var i = 0; i < list.length; i++) {
        var p = list[i];
        var gone = (p.y - p.gravityRadius > bottomY) || (p.dead && p.deadT > 1);
        if (!gone) list[keep++] = p;
      }
      list.length = keep;
    },

    // Last created non-blackhole planet (top of the chain).
    highest: function () {
      var list = this.list;
      for (var i = list.length - 1; i >= 0; i--) {
        if (list[i].type !== 'blackhole') return list[i];
      }
      return undefined;
    },

    // Marks planets swallowed by the void as dead. Returns a reused array of the newly eaten.
    consume: function (voidY) {
      eaten.length = 0;
      var list = this.list;
      for (var i = 0; i < list.length; i++) {
        var p = list[i];
        if (!p.dead && p.y - p.radius > voidY) {
          p.dead = true;
          p.deadT = 0;
          eaten.push(p);
        }
      }
      return eaten;
    }
  };
})();
