(function () {
  'use strict';
  var ORB = window.ORB = window.ORB || {};

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  // Satellite: held on a planet by an elastic tether, or flying under gravity.
  // All motion is delegated to ORB.Physics (stepTether / stepFree / launchVelocity).
  ORB.Player = {
    // New player settled on `planet`: bottom of the orbit, tangential speed, dir 1.
    create: function (planet) {
      var ang = Math.PI * 0.5;
      var d = planet.orbitRadius;
      var speed = planet.angularSpeed * d;
      // Tangent for dir 1: (-n.y, n.x) with n = (cos, sin).
      var tx = -Math.sin(ang);
      var ty = Math.cos(ang);
      var pvx = planet.vx || 0;
      var pvy = planet.vy || 0;
      return {
        x: planet.x + Math.cos(ang) * d,
        y: planet.y + Math.sin(ang) * d,
        vx: pvx + tx * speed,
        vy: pvy + ty * speed,
        state: 'orbit',
        planet: planet,
        fromPlanet: null,
        ignorePlanet: null,
        ignoreT: 0,
        angle: ang,
        dir: 1,
        latchT: 0,
        stretch: 0,
        flyTime: 0,
        boostT: 0,
        trail: [],
        shield: false,
        magnetTime: 0,
        slowTime: 0,
        speed: speed
      };
    },

    update: function (p, dt) {
      var C = ORB.CONFIG;
      if (p.state === 'orbit' && p.planet) {
        ORB.Physics.stepTether(p, dt, p.planet);
        p.latchT += dt;
      } else if (p.state === 'fly') {
        ORB.Physics.stepFree(p, dt, ORB.Planets.list, null);
        p.flyTime += dt;
        if (p.ignoreT > 0) p.ignoreT -= dt;
      }
      if (p.boostT > 0) p.boostT = Math.max(0, p.boostT - dt);

      // Trail: recycle the oldest point once full (no per-frame allocation).
      var tr = p.trail;
      var pt;
      if (tr.length >= C.TRAIL_LEN) {
        pt = tr.shift();
        while (tr.length >= C.TRAIL_LEN) tr.shift();
        pt.x = p.x;
        pt.y = p.y;
      } else {
        pt = { x: p.x, y: p.y };
      }
      tr.push(pt);
    },

    // Break orbit: keep momentum and add the launch boost along the tangent.
    launch: function (p) {
      if (p.state !== 'orbit' || !p.planet) return;
      var v = ORB.Physics.launchVelocity(p);
      p.vx = v.vx;
      p.vy = v.vy;
      p.fromPlanet = p.planet;
      p.ignorePlanet = p.planet;
      p.ignoreT = ORB.CONFIG.IGNORE_FROM_TIME;
      p.planet = null;
      p.state = 'fly';
      p.flyTime = 0;
      p.boostT = 0.35;
      p.speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
    },

    // Latch onto `planet` from the current position/velocity (velocity is kept;
    // the tether springs it in). Returns impact strength 0..1.
    latch: function (p, planet) {
      var rx = p.x - planet.x;
      var ry = p.y - planet.y;
      var d = Math.sqrt(rx * rx + ry * ry) || 1;
      var nx = rx / d;
      var ny = ry / d;
      var rvx = p.vx - (planet.vx || 0);
      var rvy = p.vy - (planet.vy || 0);
      var cross = rx * rvy - ry * rvx;
      p.dir = cross >= 0 ? 1 : -1;
      p.angle = Math.atan2(ry, rx);
      p.state = 'orbit';
      p.planet = planet;
      p.latchT = 0;
      p.stretch = planet.orbitRadius > 0 ? (d - planet.orbitRadius) / planet.orbitRadius : 0;
      var rvLen = Math.sqrt(rvx * rvx + rvy * rvy);
      var radial = Math.abs(rvx * nx + rvy * ny);
      return clamp((radial + 0.3 * rvLen) / 700, 0, 1);
    },

    // Leave the current planet without a boost (e.g. it crumbled): keep velocity.
    release: function (p) {
      if (p.state !== 'orbit' || !p.planet) return;
      p.fromPlanet = p.planet;
      p.ignorePlanet = p.planet;
      p.ignoreT = ORB.CONFIG.IGNORE_FROM_TIME;
      p.planet = null;
      p.state = 'fly';
      p.flyTime = 0;
      p.boostT = 0;
      p.speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
    },

    canLatch: function (p, planet) {
      return planet !== p.ignorePlanet || p.ignoreT <= 0;
    },

    // Unit tangent of the motion: orbit tangent around the planet, or velocity direction in flight.
    tangent: function (p) {
      if (p.state === 'fly') {
        var s = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
        if (s > 1e-6) return { x: p.vx / s, y: p.vy / s };
      }
      return {
        x: -Math.sin(p.angle) * p.dir,
        y: Math.cos(p.angle) * p.dir
      };
    }
  };
})();
