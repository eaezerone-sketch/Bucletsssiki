(function () {
  'use strict';
  var ORB = window.ORB = window.ORB || {};

  // v2 physics: planet gravity, free flight, the elastic spring tether and a
  // trajectory predictor. Everything reads ORB.CONFIG lazily (inside functions).

  var DEFAULTS = {
    GRAVITY: 4.5e6, TETHER_K: 55, TETHER_DAMP: 4.5, TETHER_TANGENT: 2.2,
    LAUNCH_BOOST: 300, LAUNCH_MIN_SPEED: 480, MAX_SPEED: 950,
    IGNORE_FROM_TIME: 0.35, PHYS_SUBSTEPS: 4, BLACKHOLE_KILL_FACTOR: 1.4,
    GRAVITY_RADIUS_FACTOR: 2.8, ORBIT_GAP: 26
  };

  function cfg(key) {
    var C = ORB.CONFIG;
    var v = C ? C[key] : undefined;
    return (typeof v === 'number' && isFinite(v)) ? v : DEFAULTS[key];
  }

  // Gravity accumulator (module-level scratch: no allocation in hot paths).
  var gAx = 0, gAy = 0, gBest = null, gBestA = 0;

  // Sum gravity at (x, y) from every live planet except `ignore`.
  function accumulate(x, y, planets, ignore, G) {
    gAx = 0; gAy = 0; gBest = null; gBestA = 0;
    if (!planets) return;
    for (var i = 0, n = planets.length; i < n; i++) {
      var pl = planets[i];
      if (pl === ignore || pl.dead) continue;
      var rad = pl.radius || 10;
      var gr = pl.gravityRadius || ((pl.orbitRadius || rad + cfg('ORBIT_GAP')) * cfg('GRAVITY_RADIUS_FACTOR'));
      var dx = pl.x - x, dy = pl.y - y;
      if (dx > gr || dx < -gr || dy > gr || dy < -gr) continue; // cheap reject
      var d2 = dx * dx + dy * dy;
      if (d2 >= gr * gr || d2 < 1e-6) continue; // outside, or d ~ 0
      var d = Math.sqrt(d2);
      var f = 1 - (d - rad) / (gr - rad);
      if (f <= 0) continue;
      if (f > 1) f = 1;
      f = f * f * (3 - 2 * f); // smoothstep
      var soft = rad * 1.3;
      var denom = d2 > soft * soft ? d2 : soft * soft;
      var m = pl.mass === undefined ? 1 : pl.mass;
      var a = G * m * f / denom;
      gAx += dx / d * a;
      gAy += dy / d * a;
      if (a > gBestA) { gBestA = a; gBest = pl; }
    }
  }

  // Substep count: configured minimum, more for long frames (stability).
  function stepsFor(dt) {
    var n = Math.round(cfg('PHYS_SUBSTEPS')) || 4;
    var need = Math.ceil(dt / 0.012);
    if (need > n) n = need;
    return n > 24 ? 24 : n;
  }

  var gravResult = { ax: 0, ay: 0, strongest: null, strength: 0 };

  // Points pool for predict(): objects are reused between calls.
  var predPool = [];
  var predResult = { points: [], hit: null };

  ORB.Physics = {
    // Gravity acceleration at a point. The returned object is reused: read it
    // immediately, don't keep a reference across calls.
    gravity: function (x, y, planets, ignore) {
      accumulate(x, y, planets, ignore || null, cfg('GRAVITY'));
      gravResult.ax = gAx;
      gravResult.ay = gAy;
      gravResult.strongest = gBest;
      gravResult.strength = gBestA;
      return gravResult;
    },

    // Free flight under gravity: semi-implicit Euler, speed-capped.
    stepFree: function (p, dt, planets, ignore) {
      if (!(dt > 0)) return;
      var n = stepsFor(dt), h = dt / n;
      var G = cfg('GRAVITY'), maxV = cfg('MAX_SPEED'), maxV2 = maxV * maxV;
      var x = p.x, y = p.y, vx = p.vx, vy = p.vy;
      ignore = ignore || null;
      for (var i = 0; i < n; i++) {
        accumulate(x, y, planets, ignore, G);
        vx += gAx * h;
        vy += gAy * h;
        var s2 = vx * vx + vy * vy;
        if (s2 > maxV2) {
          var k = maxV / Math.sqrt(s2);
          vx *= k; vy *= k;
        }
        x += vx * h;
        y += vy * h;
      }
      p.x = x; p.y = y; p.vx = vx; p.vy = vy;
      p.speed = Math.sqrt(vx * vx + vy * vy);
    },

    // Elastic tether orbit, integrated in the planet's moving frame.
    stepTether: function (p, dt, planet) {
      if (!planet || !(dt > 0)) return;
      var n = stepsFor(dt), h = dt / n;
      var K = cfg('TETHER_K') * (planet.tetherK === undefined ? 1 : planet.tetherK);
      var damp = cfg('TETHER_DAMP'), tang = cfg('TETHER_TANGENT');
      var maxV = cfg('MAX_SPEED');
      var R = planet.orbitRadius;
      var vT = (planet.angularSpeed || 0) * R;
      var dir = p.dir < 0 ? -1 : 1;
      var pvx = planet.vx || 0, pvy = planet.vy || 0;

      // Ship relative to where the planet was at the start of this step.
      var rx = p.x - (planet.x - pvx * dt);
      var ry = p.y - (planet.y - pvy * dt);
      var rvx = p.vx - pvx, rvy = p.vy - pvy;
      var d = 0;

      for (var i = 0; i < n; i++) {
        d = Math.sqrt(rx * rx + ry * ry);
        var nx, ny;
        if (d < 1e-3) { nx = 0; ny = 1; d = 1e-3; } else { nx = rx / d; ny = ry / d; }
        var tx = -ny * dir, ty = nx * dir;
        var vr = rvx * nx + rvy * ny;
        var vt = rvx * tx + rvy * ty;
        var ext = d - R;
        if (ext < -R) ext = -R; else if (ext > 2 * R) ext = 2 * R; // keep stiff spring tame
        var dc = d > 0.3 * R ? d : 0.3 * R;
        var ar = -K * ext - damp * vr - vt * vt / dc; // radial (along n)
        var at = tang * (vT - vt);                    // tangential (along t)
        rvx += (ar * nx + at * tx) * h;
        rvy += (ar * ny + at * ty) * h;
        var s2 = rvx * rvx + rvy * rvy;
        if (s2 > maxV * maxV) {
          var k = maxV / Math.sqrt(s2);
          rvx *= k; rvy *= k;
        }
        rx += rvx * h;
        ry += rvy * h;
      }

      d = Math.sqrt(rx * rx + ry * ry);
      p.x = planet.x + rx;
      p.y = planet.y + ry;
      p.vx = rvx + pvx;
      p.vy = rvy + pvy;
      p.angle = Math.atan2(ry, rx);
      p.stretch = R > 0 ? (d - R) / R : 0;
      p.speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
    },

    // Velocity after a tap: current velocity + boost along the tangent.
    launchVelocity: function (p) {
      var vx = p.vx || 0, vy = p.vy || 0;
      var tx = 0, ty = 0, have = false;
      var pl = p.planet;
      if (pl) {
        var rx = p.x - pl.x, ry = p.y - pl.y;
        var d = Math.sqrt(rx * rx + ry * ry);
        if (d > 1e-3) {
          var dir = p.dir < 0 ? -1 : 1;
          tx = -ry / d * dir; ty = rx / d * dir; have = true;
        }
      }
      if (!have) { // no planet: boost along the current heading
        var s = Math.sqrt(vx * vx + vy * vy);
        if (s > 1e-3) { tx = vx / s; ty = vy / s; } else { tx = 0; ty = -1; }
      }
      var boost = cfg('LAUNCH_BOOST');
      vx += tx * boost;
      vy += ty * boost;
      var sp = Math.sqrt(vx * vx + vy * vy);
      var minS = cfg('LAUNCH_MIN_SPEED'), maxS = cfg('MAX_SPEED');
      if (sp < 1e-6) { vx = tx * minS; vy = ty * minS; }
      else if (sp < minS) { vx *= minS / sp; vy *= minS / sp; }
      else if (sp > maxS) { vx *= maxS / sp; vy *= maxS / sp; }
      return { vx: vx, vy: vy };
    },

    // Simulate free flight from a launch. `ignore` can't be latched during the
    // first IGNORE_FROM_TIME seconds (same rule as the game). Gravity from all
    // planets acts, like stepFree(…, null). Returns one shared result object:
    // { points: [{x,y}], hit: Planet|null } valid until the next call.
    predict: function (x, y, vx, vy, planets, ignore, maxTime, step) {
      if (!(maxTime > 0)) maxTime = 1.3;
      if (!(step > 0)) step = 1 / 30;
      var G = cfg('GRAVITY'), maxV = cfg('MAX_SPEED');
      var killF = cfg('BLACKHOLE_KILL_FACTOR'), ignT = cfg('IGNORE_FROM_TIME');
      var sub = Math.max(1, Math.round(step / (1 / 240))); // ~ same h as stepFree at 60 fps
      var h = step / sub;
      var pts = predResult.points;
      var count = 0;
      var hit = null;
      var t = 0;
      var nPl = planets ? planets.length : 0;

      count = push(pts, count, x, y);
      var steps = Math.ceil(maxTime / step - 1e-9);
      outer:
      for (var s = 0; s < steps; s++) {
        for (var j = 0; j < sub; j++) {
          accumulate(x, y, planets, null, G);
          vx += gAx * h;
          vy += gAy * h;
          var s2 = vx * vx + vy * vy;
          if (s2 > maxV * maxV) {
            var k = maxV / Math.sqrt(s2);
            vx *= k; vy *= k;
          }
          x += vx * h;
          y += vy * h;
          t += h;
          for (var i = 0; i < nPl; i++) {
            var pl = planets[i];
            if (pl.dead) continue;
            var dx = x - pl.x, dy = y - pl.y;
            if (pl.type === 'blackhole') {
              var kr = (pl.radius || 10) * killF;
              if (dx * dx + dy * dy < kr * kr) { count = push(pts, count, x, y); break outer; }
              continue;
            }
            if (pl === ignore && t < ignT) continue;
            var lr = pl.latchRadius || ((pl.orbitRadius || 40) + 22);
            if (dx * dx + dy * dy < lr * lr) {
              hit = pl;
              count = push(pts, count, x, y);
              break outer;
            }
          }
        }
        count = push(pts, count, x, y);
      }
      pts.length = count;
      predResult.hit = hit;
      return predResult;
    }
  };

  // Store a point using a pooled object; returns the new count.
  function push(pts, count, x, y) {
    var o = predPool[count];
    if (!o) { o = predPool[count] = { x: 0, y: 0 }; }
    o.x = x; o.y = y;
    pts[count] = o;
    return count + 1;
  }
})();
