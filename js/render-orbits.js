(function () {
  'use strict';
  var ORB = window.ORB = window.ORB || {};

  var TAU = Math.PI * 2;
  var SEG = 48;           // polyline segments per orbit ring
  var CULL_MARGIN = 60;   // extra world px kept on screen so rings do not pop at the edges
  var BH_RINGS = 4;       // gravity-well rings per blackhole

  // Unit tables for the ring polyline, built on first use (no trig per segment per frame).
  var COS = null, SIN = null, COS5 = null, SIN5 = null;
  // Latch-zone glow sprites cached by hue bucket (12 buckets of 30 degrees).
  var sprites = {};
  // Visible world rectangle for this frame, reused (no per-frame allocation).
  var vb = { camX: 0, camY: 0, halfW: Infinity, halfH: Infinity };

  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function fract(v) { return v - Math.floor(v); }
  function wrapHue(h) { return ((h % 360) + 360) % 360; }

  // CSS hsla() string. h in degrees, s and l in percent, a 0..1.
  function hsla(h, s, l, a) {
    return 'hsla(' + wrapHue(h).toFixed(1) + ', ' + s + '%, ' + l + '%, ' + a.toFixed(3) + ')';
  }

  function buildTables() {
    COS = []; SIN = []; COS5 = []; SIN5 = [];
    for (var i = 0; i <= SEG; i++) {
      var th = i * TAU / SEG;
      COS[i] = Math.cos(th);
      SIN[i] = Math.sin(th);
      COS5[i] = Math.cos(5 * th);
      SIN5[i] = Math.sin(5 * th);
    }
  }

  // Compute the visible world rectangle (camera centre and view size / zoom).
  function updateBounds() {
    var cam = ORB.Camera, view = ORB.View;
    var zoom = 1, camX = 0, camY = 0;
    if (cam) {
      var z = typeof cam.getZoom === 'function' ? cam.getZoom() : cam.zoom;
      if (z > 0) zoom = z;
      camX = typeof cam.getX === 'function' ? cam.getX() : (cam.x || 0);
      camY = typeof cam.getY === 'function' ? cam.getY() : (cam.y || 0);
    }
    var vw = 0, vh = 0;
    if (view) {
      vw = view.visibleW ? view.visibleW(zoom) : view.w / zoom;
      vh = view.visibleH ? view.visibleH(zoom) : view.h / zoom;
    }
    vb.camX = camX;
    vb.camY = camY;
    vb.halfW = vw > 0 ? vw / 2 + CULL_MARGIN : Infinity;
    vb.halfH = vh > 0 ? vh / 2 + CULL_MARGIN : Infinity;
  }

  // Largest distance from the planet centre at which anything of it is drawn.
  function ringExtent(p) {
    var R = (p.orbitRadius || 0) * 1.12 + 16;
    if (p.latchRadius > R) R = p.latchRadius;
    if (p.type === 'blackhole' && p.gravityRadius > R) R = p.gravityRadius;
    return R;
  }

  function onScreen(p) {
    var R = ringExtent(p);
    return Math.abs(p.x - vb.camX) < vb.halfW + R && Math.abs(p.y - vb.camY) < vb.halfH + R;
  }

  // Orbit ring as a closed polyline: r = R * (1 + 0.1*amp*sin(5θ - phase)).
  // sin(5θ - φ) = sin5θ·cosφ - cos5θ·sinφ, so only one sin/cos pair is needed per ring.
  function ringPath(ctx, cx, cy, R, amp, phase) {
    ctx.beginPath();
    if (amp < 0.002) {
      ctx.arc(cx, cy, R, 0, TAU);
      return;
    }
    var cp = Math.cos(phase), sp = Math.sin(phase), k = 0.1 * amp;
    for (var i = 0; i <= SEG; i++) {
      var r = R * (1 + k * (SIN5[i] * cp - COS5[i] * sp));
      var x = cx + COS[i] * r, y = cy + SIN[i] * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
  }

  // Progress arc starting at 12 o'clock and running clockwise. frac is 0..1.
  function progressArc(ctx, cx, cy, r, frac, color, lw) {
    if (frac <= 0.001) return;
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + frac * TAU);
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.stroke();
  }

  // Soft radial glow sprite, cached per hue bucket.
  function glowSprite(hue) {
    var bucket = Math.round(wrapHue(hue) / 30) % 12;
    var spr = sprites[bucket];
    if (spr) return spr;
    var size = 96;
    var c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    var g = c.getContext('2d');
    if (!g) return null;
    var h = bucket * 30, mid = size / 2;
    var grd = g.createRadialGradient(mid, mid, 0, mid, mid, mid);
    grd.addColorStop(0, hsla(h, 90, 75, 0.9));
    grd.addColorStop(0.5, hsla(h, 90, 65, 0.3));
    grd.addColorStop(1, hsla(h, 90, 60, 0));
    g.fillStyle = grd;
    g.fillRect(0, 0, size, size);
    sprites[bucket] = c;
    return c;
  }

  // Faint latch zone; brighter while the flying player is inside the gravity field.
  function drawLatchGlow(ctx, p, player) {
    var R = p.latchRadius;
    if (!(R > 0)) return;
    var f = 0, gR = p.gravityRadius || 0;
    if (player && player.state === 'fly' && gR > 0) {
      var dx = player.x - p.x, dy = player.y - p.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      f = clamp01(1 - d / gR);
      f = f * f * (3 - 2 * f); // smoothstep
    }
    var alpha = 0.06 + 0.22 * f;
    if (player && player.planet === p) alpha *= 0.4;
    var spr = glowSprite(p.hue || 0);
    if (!spr) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(spr, p.x - R, p.y - R, R * 2, R * 2);
    ctx.restore();
  }

  // Blackhole gravity well: rings flowing inward from gravityRadius to the kill radius.
  function drawWell(ctx, p, time) {
    var gR = p.gravityRadius > 0 ? p.gravityRadius : 230;
    var kf = (ORB.CONFIG && ORB.CONFIG.BLACKHOLE_KILL_FACTOR) || 1.4;
    var kill = p.radius * kf;
    if (kill >= gR) return;
    ctx.save();
    ctx.setLineDash([]);
    ctx.lineWidth = 1.2;
    for (var k = 0; k < BH_RINGS; k++) {
      var ph = fract(time * 0.32 + k / BH_RINGS);
      var r = gR - (gR - kill) * ph;
      ctx.globalAlpha = Math.sin(ph * Math.PI) * 0.5; // fade in and out at both ends
      ctx.strokeStyle = hsla(280 - 255 * ph, 85, 72, 1); // violet outside, orange inside
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  // The orbit ring: current = solid glow, unvisited = bright flowing dashes, visited = faint.
  function drawRing(ctx, p, player, time) {
    var R = p.orbitRadius;
    if (!(R > 0)) return;
    var cur = !!player && player.planet === p;
    var amp = clamp01(p.ripple || 0), ph = p.ripplePhase || 0;
    var hue = p.hue || 0;
    ctx.save();
    if (cur) {
      var pulse = 0.5 + 0.5 * Math.sin(time * 3);
      ctx.setLineDash([]);
      ringPath(ctx, p.x, p.y, R, amp, ph);
      ctx.strokeStyle = hsla(hue, 90, 75, 0.12 + 0.05 * pulse);
      ctx.lineWidth = 8;
      ctx.stroke();
      ringPath(ctx, p.x, p.y, R, amp, ph);
      ctx.strokeStyle = hsla(hue, 95, 82, 0.6 + 0.2 * pulse);
      ctx.lineWidth = 2;
      ctx.stroke();
    } else if (p.visited) {
      ctx.setLineDash([]);
      ringPath(ctx, p.x, p.y, R, amp, ph);
      ctx.strokeStyle = hsla(hue, 70, 72, 0.16);
      ctx.lineWidth = 1;
      ctx.stroke();
    } else {
      // Soft underlay, then the dashes flowing along the ring.
      ringPath(ctx, p.x, p.y, R, amp, ph);
      ctx.setLineDash([]);
      ctx.strokeStyle = hsla(hue, 75, 75, 0.09);
      ctx.lineWidth = 4;
      ctx.stroke();
      ringPath(ctx, p.x, p.y, R, amp, ph);
      ctx.setLineDash([7, 9]);
      ctx.lineDashOffset = -((time * 28) % 16);
      ctx.strokeStyle = hsla(hue, 75, 75, 0.6);
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
    ctx.restore();
  }

  // Heat arc for stars, crumble arc for crumbling planets (both just outside the ring).
  function drawArcs(ctx, p, time) {
    var R = p.orbitRadius;
    if (!(R > 0)) return;
    if (p.type === 'star') {
      var heat = clamp01(p.heat || 0), r = R + 7;
      var pulse = heat > 0.7 ? 0.75 + 0.25 * Math.sin(time * 14) : 1;
      ctx.save();
      ctx.setLineDash([]);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, TAU);
      ctx.strokeStyle = 'hsla(50, 100%, 70%, 0.08)';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      // Yellow (cool) to red (overheated).
      progressArc(ctx, p.x, p.y, r, heat,
        hsla(50 * (1 - heat), 100, 62 - 8 * heat, 0.9 * pulse), 2.5);
      ctx.restore();
    }
    if (p.crumble >= 0 && !p.dead) {
      var c = clamp01(p.crumble);
      // The arc trembles as the planet breaks apart.
      var rc = R + 7 + Math.sin(time * 40 + (p.id | 0)) * 0.8 * c;
      ctx.save();
      ctx.lineCap = 'butt';
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, rc, 0, TAU);
      ctx.strokeStyle = 'hsla(25, 60%, 55%, 0.12)';
      ctx.lineWidth = 2;
      ctx.stroke();
      progressArc(ctx, p.x, p.y, rc, c, 'hsla(25, 90%, 62%, 0.9)', 2.5);
      ctx.restore();
    }
  }

  ORB.RenderOrbits = {
    // planets: array of Planet, world coords. player: the Player (or null).
    // Drawn before the planet bodies.
    draw: function (ctx, planets, time, player) {
      if (!ctx || !planets || !planets.length) return;
      if (!COS) buildTables();
      var t = time || 0;
      var i, p;

      updateBounds();

      ctx.save();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Pass 1: gravity wells and latch-zone glows, beneath the rings.
      for (i = 0; i < planets.length; i++) {
        p = planets[i];
        if (p.dead || !onScreen(p)) continue;
        if (p.type === 'blackhole') drawWell(ctx, p, t);
        else drawLatchGlow(ctx, p, player);
      }

      // Pass 2: rings and progress arcs.
      for (i = 0; i < planets.length; i++) {
        p = planets[i];
        if (p.dead || p.type === 'blackhole' || !onScreen(p)) continue;
        drawRing(ctx, p, player, t);
        drawArcs(ctx, p, t);
      }

      ctx.restore();
    }
  };
})();
