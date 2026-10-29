(function () {
  'use strict';
  var ORB = window.ORB = window.ORB || {};

  var TWO_PI = Math.PI * 2;

  // Floating score popups (world space).
  var POPUP_POOL = 32;
  var POPUP_LIFE = 1.4;   // total seconds
  var POPUP_FADE = 0.9;   // the last part of the life fades out over this long
  var POPUP_POP = 0.28;   // seconds of the overshoot pop-in
  var POPUP_RISE = 46;    // world px the text drifts up over its life
  var OUTLINE = '#120818';
  var FONT = '"Segoe UI", Roboto, system-ui, -apple-system, Helvetica, Arial, sans-serif';

  // Shockwave rings (world space).
  var RING_POOL = 16;
  var RING_DUR = 0.55;

  // Speed lines at the screen edges (screen space).
  var LINE_POOL = 28;
  var LINE_BAND = 0.14;   // edge band width as a fraction of the view width
  var SPEED_FROM = 0.55;  // setSpeed() values above this show lines

  // Danger vignette colour (alpha comes from the cached gradient + pulse).
  var DANGER_RGB = '255, 40, 70';

  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

  function easeOutBack(p) {
    var c1 = 1.70158, c3 = c1 + 1, q = p - 1;
    return 1 + c3 * q * q * q + c1 * q * q;
  }

  function easeOutCubic(p) {
    var q = 1 - p;
    return 1 - q * q * q;
  }

  // Pools are plain objects allocated once; nothing is allocated per frame.
  var popups = [];
  var rings = [];
  var lines = [];
  for (var i = 0; i < POPUP_POOL; i++) {
    popups.push({ on: false, x: 0, y: 0, text: '', color: '#fff', size: 22, font: '', t: 0 });
  }
  for (var j = 0; j < RING_POOL; j++) {
    rings.push({ on: false, x: 0, y: 0, color: '#fff', maxR: 120, t: 0 });
  }
  for (var k = 0; k < LINE_POOL; k++) {
    lines.push({ side: 1, u: 0, ny: 0, len: 60, spd: 1 });
  }

  var flashColor = '#ffffff';
  var flashA = 0;
  var dangerTarget = 0;
  var dangerCur = 0;
  var dangerPhase = 0;
  var speedTarget = 0;
  var speedCur = 0;

  // Cached danger gradient, rebuilt only when the view size changes.
  var gradW = 0;
  var gradH = 0;
  var dangerGrad = null;

  function findFree(pool) {
    for (var i = 0; i < pool.length; i++) {
      if (!pool[i].on) return pool[i];
    }
    // Pool full: recycle the oldest entry.
    var oldest = pool[0];
    for (var n = 1; n < pool.length; n++) {
      if (pool[n].t > oldest.t) oldest = pool[n];
    }
    return oldest;
  }

  function respawnLine(l, anywhere) {
    l.side = Math.random() < 0.5 ? -1 : 1;
    l.u = Math.random();
    l.ny = anywhere ? Math.random() : -Math.random() * 0.2;
    l.len = 40 + Math.random() * 110;   // px
    l.spd = 0.6 + Math.random() * 0.7;  // view heights per second at full speed
  }

  function ensureGradient(ctx, W, H) {
    if (dangerGrad && W === gradW && H === gradH) return;
    gradW = W;
    gradH = H;
    var r = Math.sqrt(W * W + H * H) / 2;
    dangerGrad = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, r);
    dangerGrad.addColorStop(0, 'rgba(' + DANGER_RGB + ', 0)');
    dangerGrad.addColorStop(0.5, 'rgba(' + DANGER_RGB + ', 0)');
    dangerGrad.addColorStop(0.8, 'rgba(' + DANGER_RGB + ', 0.35)');
    dangerGrad.addColorStop(1, 'rgba(' + DANGER_RGB + ', 0.85)');
  }

  ORB.FX = {
    // Clear everything (called when a new run starts).
    reset: function () {
      var i;
      for (i = 0; i < popups.length; i++) popups[i].on = false;
      for (i = 0; i < rings.length; i++) rings[i].on = false;
      for (i = 0; i < lines.length; i++) respawnLine(lines[i], true);
      flashA = 0;
      dangerTarget = 0;
      dangerCur = 0;
      speedTarget = 0;
      speedCur = 0;
    },

    // Floating text in world coords: overshoot pop, drifts up, fades out.
    popup: function (x, y, text, color, size) {
      var p = findFree(popups);
      p.on = true;
      p.x = x;
      p.y = y;
      p.text = String(text);
      p.color = color || '#ffffff';
      p.size = size > 0 ? size : 22;
      p.font = '900 ' + p.size + 'px ' + FONT;
      p.t = 0;
    },

    // Expanding ring in world coords.
    shockwave: function (x, y, color, maxR) {
      var r = findFree(rings);
      r.on = true;
      r.x = x;
      r.y = y;
      r.color = color || '#ffffff';
      r.maxR = maxR > 0 ? maxR : 120;
      r.t = 0;
    },

    // Full-screen colour flash; keeps the strongest one until it decays.
    flash: function (color, alpha) {
      var a = clamp01(alpha == null ? 0.5 : alpha);
      if (a >= flashA) {
        flashA = a;
        flashColor = color || '#ffffff';
      }
    },

    // Red pulsing vignette, 0..1. Call every frame; the value is smoothed.
    setDanger: function (v) {
      dangerTarget = clamp01(v);
    },

    // Speed lines at the screen edges, shown only above SPEED_FROM.
    setSpeed: function (v) {
      speedTarget = clamp01((v - SPEED_FROM) / (1 - SPEED_FROM));
    },

    update: function (dt) {
      if (!(dt > 0)) return;
      if (dt > 0.1) dt = 0.1;

      var i, p, r, l;
      for (i = 0; i < popups.length; i++) {
        p = popups[i];
        if (!p.on) continue;
        p.t += dt;
        if (p.t >= POPUP_LIFE) p.on = false;
      }
      for (i = 0; i < rings.length; i++) {
        r = rings[i];
        if (!r.on) continue;
        r.t += dt;
        if (r.t >= RING_DUR) r.on = false;
      }

      flashA *= Math.exp(-5.5 * dt);
      if (flashA < 0.002) flashA = 0;

      dangerCur += (dangerTarget - dangerCur) * Math.min(1, dt * 6);
      dangerPhase = (dangerPhase + dt * (4 + 6 * dangerCur)) % TWO_PI;

      speedCur += (speedTarget - speedCur) * Math.min(1, dt * 5);
      var flow = 0.5 + 0.5 * speedCur;
      for (i = 0; i < lines.length; i++) {
        l = lines[i];
        l.ny += l.spd * flow * dt;
        if (l.ny > 1) respawnLine(l, false);
      }
    },

    // World-space popups and rings. The world transform must already be set.
    drawWorld: function (ctx) {
      var i, p, r, k, e, a, s, u, dy;
      var any = false;
      for (i = 0; i < popups.length && !any; i++) any = popups[i].on;
      for (i = 0; i < rings.length && !any; i++) any = rings[i].on;
      if (!any) return;

      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';

      for (i = 0; i < rings.length; i++) {
        r = rings[i];
        if (!r.on) continue;
        k = clamp01(r.t / RING_DUR);
        e = easeOutCubic(k);
        a = (1 - k) * (1 - k);
        ctx.strokeStyle = r.color;
        // Soft wide glow, then a crisp core line.
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.maxR * e, 0, TWO_PI);
        ctx.globalAlpha = a * 0.25;
        ctx.lineWidth = 4 + 10 * (1 - k);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.maxR * e, 0, TWO_PI);
        ctx.globalAlpha = a * 0.9;
        ctx.lineWidth = 1.5 + 3 * (1 - k);
        ctx.stroke();
        // a thinner echo ring trails behind the main wave
        if (k > 0.12) {
          ctx.beginPath();
          ctx.arc(r.x, r.y, r.maxR * easeOutCubic((k - 0.12) / 0.88) * 0.7, 0, TWO_PI);
          ctx.globalAlpha = a * 0.4;
          ctx.lineWidth = 1 + 1.5 * (1 - k);
          ctx.stroke();
        }
      }

      for (i = 0; i < popups.length; i++) {
        p = popups[i];
        if (!p.on) continue;
        a = clamp01(p.t / 0.06);
        var fadeAt = POPUP_LIFE - POPUP_FADE;
        if (p.t > fadeAt) a *= clamp01(1 - (p.t - fadeAt) / POPUP_FADE);
        if (a <= 0) continue;
        s = p.t < POPUP_POP ? easeOutBack(p.t / POPUP_POP) : 1;
        if (s <= 0) continue;
        u = clamp01(p.t / POPUP_LIFE);
        dy = POPUP_RISE * (1 - (1 - u) * (1 - u));

        ctx.save();
        ctx.translate(p.x, p.y - dy);
        ctx.scale(s, s);
        if (p.t < POPUP_POP) ctx.rotate((1 - p.t / POPUP_POP) * (p.x % 2 < 1 ? 0.16 : -0.16));
        ctx.globalAlpha = a;
        ctx.font = p.font;
        ctx.lineWidth = Math.max(2, p.size * 0.22);
        ctx.strokeStyle = OUTLINE;
        ctx.strokeText(p.text, 0, 0);
        ctx.fillStyle = p.color;
        ctx.fillText(p.text, 0, 0);
        ctx.restore();
      }

      ctx.restore();
    },

    // Screen-space flash, danger vignette and speed lines.
    // The screen transform must already be set (CSS px).
    drawScreen: function (ctx) {
      var V = ORB.View;
      var W = V.cssW, H = V.cssH;
      if (!W || !H) return;
      if (flashA <= 0 && dangerCur <= 0.004 && speedCur <= 0.01) return;

      var i, l, x, y0, count;
      ctx.save();

      if (flashA > 0) {
        ctx.globalAlpha = flashA;
        ctx.fillStyle = flashColor;
        ctx.fillRect(0, 0, W, H);
      }

      if (dangerCur > 0.004) {
        ensureGradient(ctx, W, H);
        var pulse = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(dangerPhase));
        ctx.globalAlpha = clamp01(dangerCur * pulse);
        ctx.fillStyle = dangerGrad;
        ctx.fillRect(0, 0, W, H);
      }

      if (speedCur > 0.01) {
        count = Math.ceil(speedCur * LINE_POOL);
        var band = LINE_BAND * W;
        ctx.globalAlpha = speedCur * 0.4;
        ctx.strokeStyle = '#dff6ff';
        ctx.lineWidth = 1.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        for (i = 0; i < count; i++) {
          l = lines[i];
          y0 = l.ny * H;
          if (y0 > H || y0 + l.len < 0) continue;
          x = l.side < 0 ? l.u * band : W - l.u * band;
          ctx.moveTo(x, y0);
          ctx.lineTo(x, y0 + l.len);
        }
        ctx.stroke();
      }

      ctx.restore();
    }
  };
})();
