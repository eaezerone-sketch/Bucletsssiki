(function () {
  'use strict';
  var ORB = window.ORB = window.ORB || {};

  var POOL = 56;          // fixed ember pool size (no per-frame allocation)
  var MAX_PTS = 256;      // capacity of the reused surface buffers
  var TENDRILS = 7;       // dark tendrils reaching up from the surface
  var EMBER_RATE = 18;    // embers spawned per second

  // Wave layers drawn back to front (the main body is handled separately).
  var HAZE = [
    { base: -34, amp: 20, fx: 0.8, ph: 2.1, fill: 'rgba(90,0,110,0.26)' },
    { base: -14, amp: 16, fx: 1.2, ph: 4.0, fill: 'rgba(55,0,75,0.5)' }
  ];
  var MAIN = { base: 0, amp: 14, fx: 1, ph: 0 };

  var ember = null;       // pool of ember objects, life <= 0 means free
  var layerY = null;      // reused Float32Arrays for surface heights
  var cursor = 0;         // ember pool search start
  var spawnAcc = 0;       // fractional ember spawn counter
  var lastT = null;       // last draw time, for ember stepping

  function rnd(a, b) {
    return a + Math.random() * (b - a);
  }

  function ensure() {
    if (ember) return;
    ember = [];
    for (var i = 0; i < POOL; i++) {
      ember.push({ x: 0, y: 0, vx: 0, vy: 0, age: 0, life: 0, size: 1, ph: 0, hot: true });
    }
    layerY = [];
    for (var k = 0; k < HAZE.length + 1; k++) layerY.push(new Float32Array(MAX_PTS));
  }

  // Surface height of one wave layer at world x (y down; smaller = higher).
  function wave(x, t, L) {
    return L.base + L.amp * (
      Math.sin(x * 0.011 * L.fx + t * 0.9 + L.ph) +
      0.5 * Math.sin(x * 0.027 * L.fx - t * 1.7 + L.ph * 1.3) +
      0.25 * Math.sin(x * 0.061 * L.fx + t * 2.9 + L.ph * 0.7));
  }

  // Fill the sampled wave down to `bottom` as one path.
  function fillWave(ctx, ys, n, x0, step, bottom, style) {
    ctx.beginPath();
    ctx.moveTo(x0, ys[0]);
    for (var i = 1; i < n; i++) ctx.lineTo(x0 + i * step, ys[i]);
    ctx.lineTo(x0 + (n - 1) * step, bottom);
    ctx.lineTo(x0, bottom);
    ctx.closePath();
    ctx.fillStyle = style;
    ctx.fill();
  }

  // Trace the open wave line only (used for strokes).
  function traceWave(ctx, ys, n, x0, step) {
    ctx.beginPath();
    ctx.moveTo(x0, ys[0]);
    for (var i = 1; i < n; i++) ctx.lineTo(x0 + i * step, ys[i]);
  }

  function computeWave(ys, n, x0, step, t, L) {
    for (var i = 0; i < n; i++) ys[i] = wave(x0 + i * step, t, L);
  }

  // Dark tendrils rising above the surface; all in one path.
  function drawTendrils(ctx, t, camX, viewW) {
    ctx.beginPath();
    for (var i = 0; i < TENDRILS; i++) {
      var xc = camX + ((i + 0.5) / TENDRILS - 0.5) * viewW * 0.9 +
        Math.sin(t * 0.3 + i * 1.9) * viewW * 0.04;
      var sy = wave(xc, t, MAIN);
      var h = 26 + 56 * (0.5 + 0.5 * Math.sin(t * (0.6 + 0.11 * i) + i * 2.3));
      var w = 5 + (i % 3) * 3;
      var sway = Math.sin(t * 1.1 + i * 2.3) * 14;
      var by = sy + 10; // base hidden under the body
      ctx.moveTo(xc - w, by);
      ctx.quadraticCurveTo(xc - w * 0.5 + sway * 0.3, sy - h * 0.6, xc + sway, sy - h);
      ctx.quadraticCurveTo(xc + w * 0.5 + sway * 0.3, sy - h * 0.6, xc + w, by);
      ctx.closePath();
    }
    ctx.fillStyle = 'rgba(18,0,28,0.92)';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(190,40,160,0.45)';
    ctx.stroke();
  }

  function spawnEmber(x, t) {
    for (var k = 0; k < POOL; k++) {
      var idx = (cursor + k) % POOL;
      var e = ember[idx];
      if (e.life > 0) continue;
      cursor = (idx + 1) % POOL;
      e.x = x;
      e.y = wave(x, t, MAIN) + rnd(10, 60); // starts inside the darkness
      e.vx = rnd(-12, 12);
      e.vy = -rnd(28, 80);
      e.age = 0;
      e.life = rnd(1.6, 3.6);
      e.size = rnd(1.1, 2.6);
      e.ph = rnd(0, 6.283);
      e.hot = Math.random() < 0.6;
      return;
    }
  }

  // Move embers and spawn new ones inside the visible x range.
  function stepEmbers(dt, t, camX, viewW) {
    for (var i = 0; i < POOL; i++) {
      var e = ember[i];
      if (e.life <= 0) continue;
      e.age += dt;
      if (e.age >= e.life) { e.life = 0; continue; }
      e.x += (e.vx + Math.sin(e.age * 2.6 + e.ph) * 14) * dt;
      e.y += e.vy * dt;
    }
    spawnAcc += dt * EMBER_RATE;
    var guard = 0;
    while (spawnAcc >= 1 && guard++ < 4) {
      spawnAcc -= 1;
      spawnEmber(rnd(camX - viewW / 2, camX + viewW / 2), t);
    }
    if (spawnAcc > 4) spawnAcc = 0;
  }

  // Embers: a halo pass then a core pass, one path per colour group.
  function drawEmbers(ctx, camX, viewW) {
    var xa = camX - viewW / 2, xb = camX + viewW / 2;
    ctx.globalCompositeOperation = 'lighter';
    for (var pass = 0; pass < 2; pass++) {
      for (var g = 0; g < 2; g++) {
        var hot = g === 0;
        ctx.beginPath();
        for (var i = 0; i < POOL; i++) {
          var e = ember[i];
          if (e.life <= 0 || e.hot !== hot || e.x < xa || e.x > xb) continue;
          var f = 1 - e.age / e.life; // shrinks as it fades
          var r = e.size * (0.35 + 0.65 * f) * (pass === 0 ? 2.6 : 1);
          ctx.moveTo(e.x + r, e.y);
          ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
        }
        ctx.fillStyle = (hot ? 'rgba(255,90,40,' : 'rgba(180,70,255,') +
          (pass === 0 ? '0.14)' : '0.9)');
        ctx.fill();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  ORB.Void = {
    y: 0, // world y of the void's surface; it only ever rises (y decreases)

    // Place the surface and clear the embers.
    reset: function (startY) {
      ensure();
      ORB.Void.y = startY;
      for (var i = 0; i < POOL; i++) ember[i].life = 0;
      cursor = 0;
      spawnAcc = 0;
      lastT = null;
    },

    // Rise towards the player; rubber-band 3x faster when far below them.
    update: function (dt, playerY, viewH, diff) {
      if (!(dt > 0)) return;
      var speed = diff && diff.voidSpeed > 0 ? diff.voidSpeed : 16;
      if (ORB.Void.y - playerY > viewH * 0.85) speed *= 3;
      ORB.Void.y -= speed * dt;
    },

    // Distance from the surface to a world y (positive = y is above the void).
    distance: function (y) {
      return ORB.Void.y - y;
    },

    // Draw in world coords. Only the visible x range is traced.
    draw: function (ctx, time, camX, viewW, viewH) {
      if (!(viewW > 0) || !(viewH > 0)) return;
      ensure();
      var t = +time || 0;
      var dt = lastT === null ? 0 : Math.min(0.05, Math.max(0, t - lastT));
      lastT = t;

      var surfY = ORB.Void.y;
      var x0 = camX - viewW / 2 - 40;
      var x1 = camX + viewW / 2 + 40;
      var step = Math.max(6, (x1 - x0) / 96); // about 100 points per layer
      var n = Math.min(MAX_PTS, Math.ceil((x1 - x0) / step) + 1);
      var bottom = surfY + viewH + 40;

      stepEmbers(dt, t, camX, viewW);

      ctx.save();
      drawTendrils(ctx, t, camX, viewW);

      // Haze layers behind the body.
      for (var L = 0; L < HAZE.length; L++) {
        computeWave(layerY[L], n, x0, step, t, HAZE[L]);
        fillWave(ctx, layerY[L], n, x0, step, bottom, HAZE[L].fill);
      }

      // Main body: deep violet fading to black.
      var ysMain = layerY[HAZE.length];
      computeWave(ysMain, n, x0, step, t, MAIN);
      var bodyGrad = ctx.createLinearGradient(0, surfY - 30, 0, bottom);
      bodyGrad.addColorStop(0, '#3d0050');
      bodyGrad.addColorStop(0.2, '#16002a');
      bodyGrad.addColorStop(1, '#020005');
      fillWave(ctx, ysMain, n, x0, step, bottom, bodyGrad);

      // Glowing red-to-violet edge: wide faint halo, then a crisp line.
      var edge = ctx.createLinearGradient(x0, 0, x1, 0);
      edge.addColorStop(0, '#ff2d55');
      edge.addColorStop(0.5, '#b8189f');
      edge.addColorStop(1, '#6a1bff');
      traceWave(ctx, ysMain, n, x0, step);
      ctx.lineJoin = 'round';
      ctx.strokeStyle = edge;
      ctx.globalAlpha = 0.18 + 0.08 * Math.sin(t * 3);
      ctx.lineWidth = 16;
      ctx.stroke();
      ctx.globalAlpha = 0.5 + 0.2 * Math.sin(t * 2.1);
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.globalAlpha = 0.95;
      ctx.lineWidth = 2;
      ctx.stroke();

      drawEmbers(ctx, camX, viewW);
      ctx.restore();
    }
  };
})();
