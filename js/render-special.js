(function () {
  'use strict';
  var ORB = window.ORB = window.ORB || {};

  var TAU = Math.PI * 2;
  var SUN_STEPS = 8;        // heat is quantised to 8 palette steps
  var DISK_BUCKETS = 12;    // particle colour buckets, inner orange .. outer violet
  var DISK_PER = 8;         // particles per bucket
  var DISK_SQUASH = 0.32;   // accretion disk ellipse ratio (seen from above)

  // Gradients are built in unit space (radius 1) and scaled with the transform
  // at fill time, so one gradient per palette step serves every planet radius.
  var sunCache = null;      // [step] -> {glow, core, ray, prom, hot}
  var bhCache = null;       // {halo, glow, ring, cols}

  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

  function mix(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }

  function rgb(c, alpha) {
    return 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' +
      Math.round(c[2]) + ',' + alpha + ')';
  }

  // Deterministic pseudo-random in [0, 1) from a seed and an index; no allocation.
  function rnd(seed, n) {
    var s = Math.sin((seed * 0.731 + n) * 12.9898 + n * 78.233) * 43758.5453;
    return s - Math.floor(s);
  }

  // Unit-space radial gradient from [offset, css colour] stops.
  function unitGrad(ctx, stops) {
    var g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    for (var i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
    return g;
  }

  // Fill a circle of radius r around the origin with a unit-space gradient.
  function fillUnit(ctx, grad, r) {
    ctx.save();
    ctx.scale(r, r);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  // ---- Sun -----------------------------------------------------------------

  function sunPalette(ctx, step) {
    if (!sunCache) sunCache = [];
    var c = sunCache[step];
    if (c) return c;
    var t = step / (SUN_STEPS - 1);
    var edge = mix([255, 110, 40], [255, 240, 225], t);   // orange-red -> white-hot
    var mid = mix([255, 196, 80], [255, 250, 240], t);
    var core = mix([255, 246, 205], [255, 255, 255], t);
    var glowC = mix([255, 150, 50], [255, 236, 210], t);
    var flare = mix([255, 120, 30], [255, 240, 215], t);
    c = {
      glow: unitGrad(ctx, [
        [0, rgb(glowC, 0.6)], [0.35, rgb(glowC, 0.32)], [0.7, rgb(glowC, 0.08)], [1, rgb(glowC, 0)]
      ]),
      core: unitGrad(ctx, [
        [0, rgb(core, 1)], [0.55, rgb(mid, 1)], [0.9, rgb(edge, 1)], [1, rgb(edge, 0.85)]
      ]),
      ray: rgb(flare, 0.55),
      prom: rgb(flare, 0.85),
      hot: rgb(core, 1)
    };
    sunCache[step] = c;
    return c;
  }

  // Small sun: breathing glow, flickering corona rays, looping prominences, core.
  function drawStar(ctx, p, time) {
    var R = p.radius || 20;
    var heat = clamp01(p.heat || 0);
    var c = sunPalette(ctx, Math.round(heat * (SUN_STEPS - 1)));
    var seed = p.seed || 0;
    var pulse = 0.5 + 0.5 * Math.sin(time * 1.7 + seed * 0.37);
    var i, a, f, L, hw, cs, sn, mid, lift, span, cr;

    ctx.save();
    ctx.translate(p.x, p.y);

    // 1. breathing outer glow (additive)
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.7 + 0.2 * pulse + 0.1 * heat;
    fillUnit(ctx, c.glow, R * (2.6 + 0.15 * pulse));

    // 2. corona rays, flickering in length; one path, one fill
    ctx.globalAlpha = 1;
    ctx.fillStyle = c.ray;
    ctx.beginPath();
    for (i = 0; i < 12; i++) {
      a = i * TAU / 12 + 0.12 * Math.sin(time * 0.9 + i * 1.7 + seed);
      f = 0.5 + 0.5 * Math.sin(time * (3.5 + (i % 3) * 1.9) + i * 2.9 + seed);
      L = R * (1.5 + 0.9 * f * f * (0.55 + 0.45 * heat));
      hw = R * (0.12 + 0.05 * f);
      cs = Math.cos(a);
      sn = Math.sin(a);
      ctx.moveTo(cs * R * 0.85 - sn * hw, sn * R * 0.85 + cs * hw);
      ctx.lineTo(cs * L, sn * L);
      ctx.lineTo(cs * R * 0.85 + sn * hw, sn * R * 0.85 - cs * hw);
    }
    ctx.fill();

    // 3. prominences: three loops that rise off the limb and sink back
    ctx.strokeStyle = c.prom;
    ctx.lineCap = 'round';
    ctx.lineWidth = R * (0.07 + 0.03 * pulse);
    ctx.globalAlpha = 0.6 + 0.4 * pulse;
    ctx.beginPath();
    for (i = 0; i < 3; i++) {
      a = i * TAU / 3 + seed * 0.5 + 0.25 * Math.sin(time * 0.35 + i * 2.1);
      span = 0.42 + 0.14 * Math.sin(time * 0.8 + i * 1.3);
      lift = R * (1.35 + 0.45 * Math.max(0, Math.sin(time * 1.1 + i * 2.4)));
      mid = a + span / 2;
      cr = 2 * lift - 0.98 * R; // control radius so the loop peaks near `lift`
      ctx.moveTo(Math.cos(a) * R * 0.98, Math.sin(a) * R * 0.98);
      ctx.quadraticCurveTo(Math.cos(mid) * cr, Math.sin(mid) * cr,
        Math.cos(a + span) * R * 0.98, Math.sin(a + span) * R * 0.98);
    }
    ctx.stroke();

    // 4. overheated: a white-hot ring that fades in with heat
    if (heat > 0.35) {
      ctx.globalAlpha = (heat - 0.35) / 0.65 * (0.45 + 0.35 * pulse);
      ctx.strokeStyle = c.hot;
      ctx.lineWidth = R * 0.12;
      ctx.beginPath();
      ctx.arc(0, 0, R * 1.12, 0, TAU);
      ctx.stroke();
    }

    // 5. body
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    fillUnit(ctx, c.core, R);

    // 6. bright limb
    ctx.globalAlpha = 0.35 + 0.25 * pulse;
    ctx.strokeStyle = c.hot;
    ctx.lineWidth = R * 0.06;
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.97, 0, TAU);
    ctx.stroke();

    ctx.restore();
  }

  // ---- Black hole ----------------------------------------------------------

  function bhPalette(ctx) {
    if (bhCache) return bhCache;
    var cols = [];
    for (var b = 0; b < DISK_BUCKETS; b++) {
      cols.push(rgb(mix([255, 150, 50], [150, 80, 235], b / (DISK_BUCKETS - 1)), 0.85));
    }
    bhCache = {
      // lensing halo, unit radius = 4.4 * R
      halo: unitGrad(ctx, [
        [0, 'rgba(120,60,200,0.30)'], [0.23, 'rgba(90,40,170,0.26)'],
        [0.55, 'rgba(60,30,130,0.08)'], [1, 'rgba(40,20,90,0)']
      ]),
      // disk glow, unit radius = 3.3 * R (x), squashed on y
      glow: unitGrad(ctx, [
        [0.42, 'rgba(255,140,50,0)'], [0.52, 'rgba(255,140,50,0.30)'],
        [0.72, 'rgba(190,90,230,0.14)'], [0.96, 'rgba(140,60,200,0)'], [1, 'rgba(140,60,200,0)']
      ]),
      // photon ring, unit radius = 1.3 * R, bright band near 0.9
      ring: unitGrad(ctx, [
        [0, 'rgba(255,240,210,0)'], [0.7, 'rgba(255,240,210,0)'], [0.9, 'rgba(255,250,235,1)'],
        [0.96, 'rgba(255,200,120,0.35)'], [1, 'rgba(255,200,120,0)']
      ]),
      cols: cols
    };
    return bhCache;
  }

  // One pass of the streaming disk. front=false draws the far half (behind the core),
  // front=true the near half (over the core). Particles are computed from the seed,
  // so nothing is stored per frame.
  function diskParticles(ctx, R, time, seed, tilt, front, cols) {
    var b, i, h1, h2, h3, t, rN, w, a, ta, rx, sa;
    ctx.save();
    ctx.rotate(tilt);
    ctx.lineCap = 'round';
    ctx.lineWidth = R * 0.09;
    for (b = 0; b < DISK_BUCKETS; b++) {
      ctx.strokeStyle = cols[b];
      ctx.beginPath();
      for (i = b * DISK_PER; i < (b + 1) * DISK_PER; i++) {
        h1 = rnd(seed, i * 3);
        h2 = rnd(seed, i * 3 + 1);
        h3 = rnd(seed, i * 3 + 2);
        t = (b + h1) / DISK_BUCKETS;          // bucket == radial band
        rN = 1.45 + 1.7 * t;                  // radius in units of R
        w = 1.25 * Math.pow(1.45 / rN, 1.5);  // angular speed, inner faster (Kepler-like)
        a = h2 * TAU + w * time;
        sa = Math.sin(a);
        if ((sa > 0) !== front) continue;
        ta = a - w * (0.12 + 0.12 * h3);      // streak length grows with speed
        rx = rN * R;
        ctx.moveTo(Math.cos(ta) * rx, Math.sin(ta) * rx * DISK_SQUASH);
        ctx.lineTo(Math.cos(a) * rx, sa * rx * DISK_SQUASH);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  // Pitch-black core, bright photon ring, tilted streaming accretion disk, lensing halo.
  function drawBlackhole(ctx, p, time) {
    var R = p.radius || 16;
    var seed = p.seed || 0;
    var C = bhPalette(ctx);
    var flick = 0.85 + 0.15 * Math.sin(time * 3.1 + seed);
    var tilt = -0.42 + 0.06 * Math.sin(time * 0.21 + seed * 0.5);

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.globalCompositeOperation = 'lighter';

    // 1. lensing halo
    ctx.globalAlpha = 1;
    fillUnit(ctx, C.halo, R * 4.4);

    // 2. disk glow, tilted and squashed
    ctx.save();
    ctx.rotate(tilt);
    ctx.scale(R * 3.3, R * 3.3 * DISK_SQUASH);
    ctx.fillStyle = C.glow;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, TAU);
    ctx.fill();
    ctx.restore();

    // 3. far half of the disk, dimmer, hidden behind the core
    ctx.globalAlpha = 0.45 * flick;
    diskParticles(ctx, R, time, seed, tilt, false, C.cols);

    // 4. black core (source-over so it really hides what is behind it)
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, TAU);
    ctx.fill();

    // 5. photon ring
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = flick;
    fillUnit(ctx, C.ring, R * 1.3);

    // 6. near half of the disk, passing in front of the core
    ctx.globalAlpha = 1;
    diskParticles(ctx, R, time, seed, tilt, true, C.cols);

    ctx.restore();
  }

  ORB.RenderSpecial = {
    drawStar: drawStar,
    drawBlackhole: drawBlackhole
  };
})();
