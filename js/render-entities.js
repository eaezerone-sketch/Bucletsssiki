(function () {
  'use strict';
  var ORB = window.ORB = window.ORB || {};

  var STAR_COLOR = '#ffd86b';
  var STAR_RGB = '255,216,107';
  var ROCK_FILL = '#6b5d52';
  var ROCK_EDGE = '#a38f7e';
  var ROCK_GLOW_RGB = '255,90,90';
  var PU_COLORS = { shield: '#4da3ff', magnet: '#ff5a5a', slow: '#5dff8a' };
  var PU_RGB = { shield: '77,163,255', magnet: '255,90,90', slow: '93,255,138' };
  var COMET_GLOW_RGB = '120,210,255';
  var COMET_CORE_RGB = '240,252,255';
  var VIOLET_RGB = '170,80,255';
  var PINK_RGB = '255,120,220';
  var CYAN_RGB = '63,240,255';
  var ICE_RGB = '210,250,255';
  var TWO_PI = Math.PI * 2;

  // ---- cached glow sprites (created lazily, one per colour) ----
  var sprites = {};

  function glowSprite(rgb) {
    var s = sprites[rgb];
    if (s) return s;
    var size = 128;
    s = document.createElement('canvas');
    s.width = size;
    s.height = size;
    var g = s.getContext('2d');
    var grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grd.addColorStop(0, 'rgba(' + rgb + ',1)');
    grd.addColorStop(0.35, 'rgba(' + rgb + ',0.45)');
    grd.addColorStop(1, 'rgba(' + rgb + ',0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, size, size);
    sprites[rgb] = s;
    return s;
  }

  // Soft radial glow centred at (x, y) with the given radius. Restores globalAlpha.
  function glow(ctx, x, y, radius, rgb, alpha) {
    var prev = ctx.globalAlpha;
    ctx.globalAlpha = prev * alpha;
    ctx.drawImage(glowSprite(rgb), x - radius, y - radius, radius * 2, radius * 2);
    ctx.globalAlpha = prev;
  }

  // ---- view culling (camera / view are optional) ----
  var view = { on: false, x0: 0, y0: 0, x1: 0, y1: 0 };

  function updateView() {
    var cam = ORB.Camera;
    var vw = ORB.View;
    view.on = false;
    if (!cam || !vw) return;
    var zoom = typeof cam.getZoom === 'function' ? cam.getZoom() : cam.zoom;
    if (!(zoom > 0)) zoom = 1;
    var cx = typeof cam.getX === 'function' ? cam.getX() : cam.x;
    var cy = typeof cam.getY === 'function' ? cam.getY() : cam.y;
    var w = typeof vw.visibleW === 'function' ? vw.visibleW(zoom) : vw.w / zoom;
    var h = typeof vw.visibleH === 'function' ? vw.visibleH(zoom) : vw.h / zoom;
    if (!isFinite(cx) || !isFinite(cy) || !(w > 0) || !(h > 0)) return;
    view.x0 = cx - w / 2;
    view.x1 = cx + w / 2;
    view.y0 = cy - h / 2;
    view.y1 = cy + h / 2;
    view.on = true;
  }

  function onScreen(x, y, pad) {
    if (!view.on) return true;
    return x >= view.x0 - pad && x <= view.x1 + pad &&
      y >= view.y0 - pad && y <= view.y1 + pad;
  }

  // ---- shapes ----

  // 5-point star path centred at (cx, cy)
  function starPath(ctx, cx, cy, outer, inner) {
    ctx.beginPath();
    for (var i = 0; i < 10; i++) {
      var r = i % 2 === 0 ? outer : inner;
      var a = -Math.PI / 2 + i * Math.PI / 5;
      var px = cx + Math.cos(a) * r;
      var py = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  // Four-point twinkle (fill it with the caller's fillStyle)
  function sparkle(ctx, x, y, s) {
    if (s <= 0.2) return;
    ctx.beginPath();
    ctx.moveTo(x, y - s);
    ctx.quadraticCurveTo(x, y, x + s, y);
    ctx.quadraticCurveTo(x, y, x, y + s);
    ctx.quadraticCurveTo(x, y, x - s, y);
    ctx.quadraticCurveTo(x, y, x, y - s);
    ctx.fill();
  }

  // ---- stars ----

  function drawStars(ctx, stars, time) {
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      if (!s || s.collected || !onScreen(s.x, s.y, s.r * 4 + 20)) continue;
      var R = s.r * (1 + 0.12 * Math.sin(time * 3 + s.phase));
      glow(ctx, s.x, s.y, R * 3, STAR_RGB, 0.5);
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(time * 1.5 + s.phase);
      starPath(ctx, 0, 0, R, R * 0.45);
      ctx.fillStyle = STAR_COLOR;
      ctx.fill();
      starPath(ctx, 0, 0, R * 0.55, R * 0.25);
      ctx.fillStyle = 'rgba(255,246,208,0.7)';
      ctx.fill();
      ctx.restore();
    }
  }

  // ---- asteroids ----

  function drawAsteroids(ctx, asteroids) {
    for (var i = 0; i < asteroids.length; i++) {
      var a = asteroids[i];
      if (!a || !a.verts || !onScreen(a.x, a.y, a.r * 2 + 30)) continue;
      glow(ctx, a.x, a.y, a.r * 2, ROCK_GLOW_RGB, 0.3); // warning glow
      var n = a.verts.length;
      ctx.save();
      ctx.translate(a.x, a.y);
      ctx.rotate(a.rot);
      ctx.beginPath();
      for (var k = 0; k < n; k++) {
        var ang = (k / n) * TWO_PI;
        var rr = a.r * a.verts[k];
        var px = Math.cos(ang) * rr;
        var py = Math.sin(ang) * rr;
        if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = ROCK_FILL;
      ctx.fill();
      ctx.strokeStyle = ROCK_EDGE;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.restore();
    }
  }

  // ---- power-ups ----

  function drawPowerIcon(ctx, kind, k, color) {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = Math.max(1.5, k * 0.22);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    var i, a;
    if (kind === 'shield') {
      // hexagon with a faint inner fill
      ctx.beginPath();
      for (i = 0; i < 6; i++) {
        a = -Math.PI / 2 + i * Math.PI / 3;
        if (i === 0) ctx.moveTo(Math.cos(a) * k, Math.sin(a) * k);
        else ctx.lineTo(Math.cos(a) * k, Math.sin(a) * k);
      }
      ctx.closePath();
      ctx.globalAlpha = 0.35;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.stroke();
    } else if (kind === 'magnet') {
      // U-shaped magnet opening upward
      ctx.beginPath();
      ctx.arc(0, 0, k * 0.7, 0, Math.PI, false);
      ctx.lineTo(-k * 0.7, -k * 0.7);
      ctx.moveTo(k * 0.7, 0);
      ctx.lineTo(k * 0.7, -k * 0.7);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-k * 0.7, -k * 0.35);
      ctx.lineTo(-k * 0.7, -k * 0.7);
      ctx.moveTo(k * 0.7, -k * 0.35);
      ctx.lineTo(k * 0.7, -k * 0.7);
      ctx.stroke();
    } else if (kind === 'slow') {
      // hourglass
      var w = k * 0.6;
      ctx.beginPath();
      ctx.moveTo(-w, -k);
      ctx.lineTo(w, -k);
      ctx.lineTo(0, 0);
      ctx.closePath();
      ctx.globalAlpha = 0.35;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-w, k);
      ctx.lineTo(w, k);
      ctx.lineTo(0, 0);
      ctx.closePath();
      ctx.globalAlpha = 0.35;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.stroke();
    }
  }

  function drawPowerups(ctx, powerups, time) {
    for (var i = 0; i < powerups.length; i++) {
      var p = powerups[i];
      if (!p || p.collected || !onScreen(p.x, p.y, p.r * 3 + 30)) continue;
      var color = PU_COLORS[p.kind] || '#ffffff';
      var rgb = PU_RGB[p.kind] || '255,255,255';
      var R = p.r * (1 + 0.08 * Math.sin(time * 4 + p.phase));
      glow(ctx, p.x, p.y, R * 2.6, rgb, 0.55);
      ctx.save();
      ctx.beginPath();
      ctx.arc(p.x, p.y, R, 0, TWO_PI);
      ctx.fillStyle = 'rgba(8,6,20,0.85)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.translate(p.x, p.y);
      drawPowerIcon(ctx, p.kind, R * 0.55, color);
      ctx.restore();
    }
  }

  // ---- comets ----

  // Scratch buffers, reused every frame (no per-frame allocation).
  var PX = [], PY = [], NX = [], NY = [];

  // Fills PX/PY with the head followed by the tail, nearest-to-head first.
  // Accepts tails stored either oldest-first or newest-first.
  function buildTail(c) {
    var tail = c.tail || [];
    var n = tail.length;
    PX.length = 0;
    PY.length = 0;
    PX.push(c.x);
    PY.push(c.y);
    if (n === 0) return 1;
    var newestLast = true;
    if (n > 1) {
      var a = tail[0], b = tail[n - 1];
      var da = (a.x - c.x) * (a.x - c.x) + (a.y - c.y) * (a.y - c.y);
      var db = (b.x - c.x) * (b.x - c.x) + (b.y - c.y) * (b.y - c.y);
      newestLast = db <= da;
    }
    for (var k = 0; k < n; k++) {
      var p = newestLast ? tail[n - 1 - k] : tail[k];
      PX.push(p.x);
      PY.push(p.y);
    }
    return PX.length;
  }

  function computeNormals(m) {
    for (var i = 0; i < m; i++) {
      var i0 = i > 0 ? i - 1 : 0;
      var i1 = i < m - 1 ? i + 1 : m - 1;
      var dx = PX[i1] - PX[i0];
      var dy = PY[i1] - PY[i0];
      var l = Math.sqrt(dx * dx + dy * dy) || 1;
      NX[i] = -dy / l;
      NY[i] = dx / l;
    }
  }

  // Width taper along the tail: full at the head, zero at the tip.
  function taper(i, m) {
    return Math.pow(1 - i / (m - 1), 0.8);
  }

  // One filled tapered ribbon along PX/PY, fading from the head colour to transparent.
  function fillRibbon(ctx, m, w0, rgb, alpha) {
    var g = ctx.createLinearGradient(PX[0], PY[0], PX[m - 1], PY[m - 1]);
    g.addColorStop(0, 'rgba(' + rgb + ',' + alpha + ')');
    g.addColorStop(1, 'rgba(' + rgb + ',0)');
    ctx.beginPath();
    var i, hw;
    for (i = 0; i < m; i++) {
      hw = w0 * taper(i, m);
      var lx = PX[i] + NX[i] * hw;
      var ly = PY[i] + NY[i] * hw;
      if (i === 0) ctx.moveTo(lx, ly); else ctx.lineTo(lx, ly);
    }
    for (i = m - 1; i >= 0; i--) {
      hw = w0 * taper(i, m);
      ctx.lineTo(PX[i] - NX[i] * hw, PY[i] - NY[i] * hw);
    }
    ctx.closePath();
    ctx.fillStyle = g;
    ctx.fill();
  }

  function drawComet(ctx, c, idx, time) {
    var r = c.r || 7;
    var fade = c.used ? 0.5 : 1;
    var hx = c.x;
    var hy = c.y;
    if (!onScreen(hx, hy, 320)) return;

    var m = buildTail(c);
    if (m > 2) {
      computeNormals(m);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      fillRibbon(ctx, m, r * 2.4, COMET_GLOW_RGB, (0.5 * fade).toFixed(3));
      fillRibbon(ctx, m, r * 0.7, COMET_CORE_RGB, (0.95 * fade).toFixed(3));
      // twinkles drifting along the tail
      for (var i = 2; i < m; i += 3) {
        var t = i / m;
        var fadeT = (1 - t) * fade;
        var jitter = Math.sin(i * 7.3 + time * 5 + idx) * r * 1.2 * (1 - t);
        var sx = PX[i] + NX[i] * jitter;
        var sy = PY[i] + NY[i] * jitter;
        var tw = 0.5 + 0.5 * Math.sin(time * 10 + i * 2.1 + idx * 1.7);
        ctx.fillStyle = 'rgba(' + ICE_RGB + ',' + (fadeT * tw).toFixed(3) + ')';
        sparkle(ctx, sx, sy, r * 0.9 * (1 - t) * (0.5 + tw * 0.5));
      }
      ctx.restore();
    }

    // bright icy head
    glow(ctx, hx, hy, r * 5, COMET_GLOW_RGB, 0.9 * fade);
    glow(ctx, hx, hy, r * 1.9, COMET_CORE_RGB, fade);
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,' + fade + ')';
    ctx.beginPath();
    ctx.arc(hx, hy, r * 0.9, 0, TWO_PI);
    ctx.fill();
    // a few sparkles orbiting the head
    for (var k = 0; k < 3; k++) {
      var ang = time * 1.3 + idx * 2 + k * (TWO_PI / 3);
      var dist = r * (2.2 + 0.6 * Math.sin(time * 4 + k));
      var tw2 = 0.5 + 0.5 * Math.sin(time * 9 + k * 2.3 + idx);
      ctx.fillStyle = 'rgba(' + ICE_RGB + ',' + (fade * tw2).toFixed(3) + ')';
      sparkle(ctx, hx + Math.cos(ang) * dist, hy + Math.sin(ang) * dist, r * 0.8 * tw2);
    }
    ctx.restore();
  }

  function drawComets(ctx, comets, time) {
    for (var i = 0; i < comets.length; i++) {
      var c = comets[i];
      if (!c) continue;
      drawComet(ctx, c, i, time);
    }
  }

  // ---- wormholes ----

  // Entry: violet arms with pink highlights, spinning clockwise.
  // Exit: cyan arms with ice highlights, spinning counter-clockwise.
  function drawWormhole(ctx, w, time) {
    var r = w.r || 18;
    if (!onScreen(w.x, w.y, r * 4 + 20)) return;
    var isExit = !!w.isExit;
    var armRgb = isExit ? CYAN_RGB : VIOLET_RGB;
    var accentRgb = isExit ? ICE_RGB : PINK_RGB;
    var dir = isExit ? -1 : 1;
    var ph = w.phase || 0;
    var pulse = 1 + 0.08 * Math.sin(time * 3 + ph);
    var dim = w.cooldown > 0 ? 0.55 : 1;
    var x = w.x;
    var y = w.y;

    glow(ctx, x, y, r * 3.4 * pulse, armRgb, 0.55 * dim);

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // three rotating spiral arms
    var spin = time * 1.8 * dir + ph;
    for (var a = 0; a < 3; a++) {
      var base = spin + a * (TWO_PI / 3);
      ctx.beginPath();
      for (var k = 0; k <= 14; k++) {
        var t = k / 14;
        var rho = r * (0.3 + 1.9 * t) * pulse;
        var th = base + t * 2.4;
        var px = x + Math.cos(th) * rho;
        var py = y + Math.sin(th) * rho;
        if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.globalAlpha = 0.25 * dim;
      ctx.strokeStyle = 'rgb(' + armRgb + ')';
      ctx.lineWidth = r * 0.7;
      ctx.stroke();
      ctx.globalAlpha = 0.9 * dim;
      ctx.strokeStyle = 'rgb(' + accentRgb + ')';
      ctx.lineWidth = 1.8;
      ctx.stroke();
    }

    // dashed event-horizon ring flowing around the vortex
    ctx.setLineDash([3, 5]);
    ctx.lineDashOffset = -time * 14 * dir;
    ctx.globalAlpha = 0.5 * dim;
    ctx.strokeStyle = 'rgb(' + accentRgb + ')';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, r * 1.45 * pulse, 0, TWO_PI);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;

    // pulsing core with a dark centre and bright rim
    ctx.globalAlpha = 1;
    glow(ctx, x, y, r * 1.1 * pulse, accentRgb, 0.9 * dim);
    ctx.globalAlpha = dim;
    ctx.fillStyle = 'rgba(6,2,16,0.92)';
    ctx.beginPath();
    ctx.arc(x, y, r * 0.42, 0, TWO_PI);
    ctx.fill();
    ctx.strokeStyle = 'rgb(' + accentRgb + ')';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.restore();
  }

  function drawWormholes(ctx, wormholes, time) {
    for (var i = 0; i < wormholes.length; i++) {
      if (wormholes[i]) drawWormhole(ctx, wormholes[i], time);
    }
  }

  ORB.RenderEntities = {
    // world coords. comets / wormholes may be undefined (treated as empty).
    draw: function (ctx, stars, asteroids, powerups, comets, wormholes, time) {
      // legacy call: draw(ctx, stars, asteroids, powerups, time)
      if (typeof comets === 'number') {
        time = comets;
        comets = null;
        wormholes = null;
      }
      time = time || 0;
      updateView();
      ctx.save();
      drawStars(ctx, stars || [], time);
      drawAsteroids(ctx, asteroids || []);
      drawPowerups(ctx, powerups || [], time);
      drawComets(ctx, comets || [], time);
      drawWormholes(ctx, wormholes || [], time);
      ctx.restore();
    }
  };
})();
