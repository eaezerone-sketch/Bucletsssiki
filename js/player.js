(function () {
  'use strict';
  var ORB = window.ORB = window.ORB || {};

  // Satellite: orbits a planet, or flies straight along the tangent after launch.
  ORB.Player = {
    // New player orbiting `planet`, starting at the bottom of the orbit.
    create: function (planet) {
      var ang = Math.PI * 0.5;
      var d = planet.orbitRadius;
      return {
        x: planet.x + Math.cos(ang) * d,
        y: planet.y + Math.sin(ang) * d,
        vx: 0,
        vy: 0,
        state: 'orbit',
        planet: planet,
        fromPlanet: null,
        angle: ang,
        dir: 1,
        orbitDist: d,
        flyTime: 0,
        trail: [],
        shield: false,
        magnetTime: 0,
        slowTime: 0
      };
    },

    update: function (p, dt) {
      var C = ORB.CONFIG;
      if (p.state === 'orbit' && p.planet) {
        var pl = p.planet;
        p.angle += p.dir * pl.angularSpeed * dt;
        // Ease the orbit radius toward the planet's current orbit radius.
        p.orbitDist += (pl.orbitRadius - p.orbitDist) * Math.min(1, 8 * dt);
        p.x = pl.x + Math.cos(p.angle) * p.orbitDist;
        p.y = pl.y + Math.sin(p.angle) * p.orbitDist;
        // Tangential velocity, used for rendering.
        var t = this.tangent(p);
        var speed = pl.angularSpeed * p.orbitDist;
        p.vx = t.x * speed;
        p.vy = t.y * speed;
      } else if (p.state === 'fly') {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.flyTime += dt;
      }

      p.trail.push({ x: p.x, y: p.y });
      if (p.trail.length > C.TRAIL_LEN) {
        p.trail.splice(0, p.trail.length - C.TRAIL_LEN);
      }
    },

    // Break orbit: fly straight along the current tangent.
    launch: function (p) {
      if (p.state !== 'orbit' || !p.planet) return;
      var t = this.tangent(p);
      var s = ORB.CONFIG.LAUNCH_SPEED;
      p.vx = t.x * s;
      p.vy = t.y * s;
      p.fromPlanet = p.planet;
      p.planet = null;
      p.state = 'fly';
      p.flyTime = 0;
    },

    // Start orbiting `planet` from the current position and velocity.
    capture: function (p, planet) {
      var rx = p.x - planet.x;
      var ry = p.y - planet.y;
      p.angle = Math.atan2(ry, rx);
      p.orbitDist = Math.sqrt(rx * rx + ry * ry);
      var cross = rx * p.vy - ry * p.vx;
      p.dir = cross >= 0 ? 1 : -1;
      p.state = 'orbit';
      p.planet = planet;
      p.vx = 0;
      p.vy = 0;
    },

    // Unit tangent of the current orbit (direction of motion).
    tangent: function (p) {
      return {
        x: -Math.sin(p.angle) * p.dir,
        y: Math.cos(p.angle) * p.dir
      };
    }
  };
})();
