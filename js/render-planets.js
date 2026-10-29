(function () {
  'use strict';
  var ORB = window.ORB = window.ORB || {};

  var TAU = Math.PI * 2;

  // Deterministic PRNG (xorshift32) so each planet keeps the same details every frame.
  function seeded(seed) {
    var s = (seed >>> 0) || 1;
    return function () {
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
      s >>>= 0;
      return s / 4294967296;
    };
  }

  function H(h) { return ((h % 360) + 360) % 360; }

  // Shorthand for ORB.M.hsl with the hue wrapped into 0..360.
  function col(M, h, s, l, a) { return M.hsl(H(h), s, l, a); }

  // Off-screen planets are skipped. Uses the camera and view if they exist.
  function visible(p, camY, limit) {
    return Math.abs(p.y - camY) - p.orbitRadius <= limit;
  }

  function drawOrbit(ctx, M, p, current, cfg) {
    ctx.save();
    if (p === current) {
      ctx.strokeStyle = col(M, p.hue, 90, 75, 0.45);
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
    } else {
      ctx.strokeStyle = col(M, p.hue, 60, 70, 0.14);
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 7]);
    }
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.orbitRadius, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // Ring: back half drawn before the body, front half after it.
  function drawRing(ctx, M, p, back) {
    var r = p.radius, rx = r * 1.9, ry = r * 0.42;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(-0.28);
    ctx.lineCap = 'butt';
    var a0 = back ? Math.PI : 0, a1 = back ? TAU : Math.PI;

    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, a0, a1);
    ctx.strokeStyle = col(M, p.hue + 30, 80, 80, 0.5);
    ctx.lineWidth = Math.max(1.5, r * 0.14);
    ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(0, 0, rx * 0.8, ry * 0.8, 0, a0, a1);
    ctx.strokeStyle = col(M, p.hue + 30, 90, 90, 0.25);
    ctx.lineWidth = Math.max(0.8, r * 0.05);
    ctx.stroke();
    ctx.restore();
  }

  function drawBody(ctx, M, p, time) {
    var r = p.radius, x = p.x, y = p.y, hue = p.hue;
    var rnd = seeded(Math.imul((p.id | 0) + 1, 2654435761));

    ctx.save();

    // Soft outer glow.
    var g = ctx.createRadialGradient(x, y, r * 0.8, x, y, r * 2.6);
    g.addColorStop(0, col(M, hue, 90, 65, 0.32));
    g.addColorStop(1, col(M, hue, 90, 65, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r * 2.6, 0, TAU);
    ctx.fill();

    if (p.ringed) drawRing(ctx, M, p, true);

    // Body, lit from the upper left.
    g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.05, x, y, r);
    g.addColorStop(0, col(M, hue, 85, 82, 1));
    g.addColorStop(0.5, col(M, hue, 65, 52, 1));
    g.addColorStop(1, col(M, hue + 10, 55, 16, 1));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();

    // Surface details, clipped to the disc.
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.clip();

    var bands = 2 + Math.floor(rnd() * 2), i;
    for (i = 0; i < bands; i++) {
      var by = y + (rnd() * 2 - 1) * r * 0.65;
      var bh = r * (0.07 + rnd() * 0.12);
      var sx = x + Math.sin(time * 0.15 + i * 1.7) * r * 0.08;
      ctx.fillStyle = col(M, hue, 45, 30, 0.3);
      ctx.beginPath();
      ctx.ellipse(sx, by, r * 1.1, bh, 0, 0, TAU);
      ctx.fill();
    }

    var craters = 3 + Math.floor(rnd() * 3);
    for (i = 0; i < craters; i++) {
      var cx = x + (rnd() * 2 - 1) * r * 0.6;
      var cy = y + (rnd() * 2 - 1) * r * 0.6;
      var cr = r * (0.07 + rnd() * 0.1);
      ctx.fillStyle = col(M, hue, 35, 22, 0.45);
      ctx.beginPath();
      ctx.arc(cx, cy, cr, 0, TAU);
      ctx.fill();
      // Lit rim on the lower-right side.
      ctx.strokeStyle = col(M, hue, 70, 85, 0.22);
      ctx.lineWidth = Math.max(0.6, r * 0.03);
      ctx.beginPath();
      ctx.arc(cx, cy, cr, 0, Math.PI * 0.6);
      ctx.stroke();
    }

    // Shadow on the lower-right (terminator).
    g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.3, x, y, r);
    g.addColorStop(0, 'rgba(5,1,15,0)');
    g.addColorStop(0.75, 'rgba(5,1,15,0)');
    g.addColorStop(1, 'rgba(5,1,15,0.6)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    ctx.restore();

    // Thin rim light on the upper-left edge.
    ctx.strokeStyle = col(M, hue, 90, 85, 0.35);
    ctx.lineWidth = Math.max(0.8, r * 0.04);
    ctx.beginPath();
    ctx.arc(x, y, r - 0.5, Math.PI * 1.1, Math.PI * 1.6);
    ctx.stroke();

    if (p.ringed) drawRing(ctx, M, p, false);

    ctx.restore();
  }

  // Small pulsing check mark at the upper right of a visited planet.
  function drawMarker(ctx, M, p, time, cfg) {
    var d = p.radius + 10, ang = -Math.PI * 0.25;
    var mx = p.x + Math.cos(ang) * d, my = p.y + Math.sin(ang) * d;
    var pulse = 0.75 + 0.25 * Math.sin(time * 2 + (p.id | 0));
    var accent = cfg.COLORS.accent;

    ctx.save();
    ctx.globalAlpha = 0.25 * pulse;
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(mx, my, 7, 0, TAU);
    ctx.fill();

    ctx.globalAlpha = pulse;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(mx - 2.6, my + 0.2);
    ctx.lineTo(mx - 0.6, my + 2.4);
    ctx.lineTo(mx + 2.9, my - 2.2);
    ctx.stroke();
    ctx.restore();
  }

  ORB.RenderPlanets = {
    // planets: array of Planet, world coords. currentPlanet: planet the player orbits (or null).
    draw: function (ctx, planets, time, currentPlanet) {
      if (!planets || !planets.length) return;
      var M = ORB.M, cfg = ORB.CONFIG, cam = ORB.Camera, view = ORB.View;
      var camY = cam ? cam.y : 0;
      var limit = view && view.h ? view.h * 0.8 + 80 : Infinity;
      var i, p;

      ctx.save();
      ctx.setLineDash([]);

      // Orbit guides first, so they sit beneath every body.
      for (i = 0; i < planets.length; i++) {
        p = planets[i];
        if (visible(p, camY, limit)) drawOrbit(ctx, M, p, currentPlanet, cfg);
      }

      for (i = 0; i < planets.length; i++) {
        p = planets[i];
        if (!visible(p, camY, limit)) continue;
        drawBody(ctx, M, p, time);
        if (p.visited) drawMarker(ctx, M, p, time, cfg);
      }

      ctx.setLineDash([]);
      ctx.restore();
    }
  };
})();
