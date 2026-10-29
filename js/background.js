(function () {
  'use strict';
  var ORB = window.ORB = window.ORB || {};

  // Parallax layers: [count, scroll factor, max star size, base alpha]
  var LAYERS = [
    { count: 60, factor: 0.05, size: 1.0, alpha: 0.45 },
    { count: 40, factor: 0.15, size: 1.4, alpha: 0.65 },
    { count: 25, factor: 0.3, size: 2.0, alpha: 0.9 }
  ];

  var MOTE_COUNT = 36;      // slow dust motes
  var SHOOTER_COUNT = 2;    // shooting-star pool size
  var NEB_SIZE = 128;       // nebula sprite resolution (soft gradient, upscaled)

  // Flat Float32Array per layer, 4 floats per star: nx, ny, size, phase.
  var layerData = null;
  var motes = null;         // 4 floats per mote: nx, ny, size, phase
  var galaxies = null;      // distant spiral galaxies, sprites rebuilt on resize
  var shooters = null;      // pool of shooting stars
  var shootT = 0;           // seconds until the next shooting star
  var lastT = -1;           // previous draw time, for dt
  var baseCanvas = null;    // static vertical gradient (cached per size)
  var vignetteCanvas = null; // static edge darkening (cached per size)
  var nebulae = [];         // [{ canvas, q }] sprites, repainted when hue steps
  var registered = false;

  function wrap(v, m) {
    return ((v % m) + m) % m;
  }

  function wrapHue(h) {
    return wrap(h, 360);
  }

  // Offscreen canvas at device resolution whose context uses CSS px units.
  function newLayer(w, h) {
    var dpr = ORB.View.dpr || 1;
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * dpr));
    c.height = Math.max(1, Math.round(h * dpr));
    var x = c.getContext('2d');
    x.setTransform(c.width / w, 0, 0, c.height / h, 0, 0);
    return { canvas: c, ctx: x };
  }

  // Base gradient and vignette: depend only on the viewport size. They are blitted 1:1
  // (an unscaled drawImage is far cheaper than a gradient fill or a scaled blit).
  function buildBase(w, h) {
    var C = ORB.CONFIG.COLORS;

    var base = newLayer(w, h);
    var g = base.ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, C.bg1);
    g.addColorStop(1, C.bg2);
    base.ctx.fillStyle = g;
    base.ctx.fillRect(0, 0, w, h);
    baseCanvas = base.canvas;

    var vig = newLayer(w, h);
    var inner = Math.min(w, h) * 0.35;
    var outer = Math.sqrt(w * w + h * h) / 2;
    var vg = vig.ctx.createRadialGradient(w / 2, h / 2, inner, w / 2, h / 2, outer);
    vg.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vg.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
    vig.ctx.fillStyle = vg;
    vig.ctx.fillRect(0, 0, w, h);
    vignetteCanvas = vig.canvas;
  }

  // Paint one distant spiral galaxy (two soft arms + core) into its own sprite.
  function paintGalaxy(g, w, h) {
    var M = ORB.M;
    var R = Math.max(14, Math.min(w, h) * g.rFrac);
    var L = newLayer(R * 2, R * 2);
    var x = L.ctx;
    x.translate(R, R);

    var cg = x.createRadialGradient(0, 0, 0, 0, 0, R * 0.45);
    cg.addColorStop(0, M.hsl(g.hue, 60, 95, 0.9));
    cg.addColorStop(0.4, M.hsl(g.hue, 70, 75, 0.35));
    cg.addColorStop(1, M.hsl(g.hue, 70, 60, 0));
    x.fillStyle = cg;
    x.fillRect(-R, -R, R * 2, R * 2);

    x.save();
    x.scale(1, g.tilt); // inclination: squash the disc
    var i, a, rr, th, t;
    for (i = 0; i < 50; i++) {      // faint dust across the disc
      a = Math.random() * Math.PI * 2;
      rr = R * Math.sqrt(Math.random());
      x.fillStyle = M.hsl(g.hue, 50, 80, 0.12);
      x.beginPath();
      x.arc(Math.cos(a) * rr, Math.sin(a) * rr, R * 0.03, 0, Math.PI * 2);
      x.fill();
    }
    for (var arm = 0; arm < 2; arm++) {  // two logarithmic-ish arms
      for (i = 0; i < 80; i++) {
        t = i / 80;
        th = arm * Math.PI + t * Math.PI * 2.4;
        rr = R * (0.12 + 0.8 * t) + (Math.random() - 0.5) * R * 0.1 * (0.4 + t);
        x.fillStyle = M.hsl(g.hue + 10 * t, 70, 80, 0.6 * (1 - 0.6 * t));
        x.beginPath();
        x.arc(Math.cos(th) * rr, Math.sin(th) * rr, R * (0.05 - 0.025 * t), 0, Math.PI * 2);
        x.fill();
      }
    }
    x.restore();

    g.R = R;
    g.layer = L.canvas;
  }

  function buildGalaxies(w, h) {
    for (var i = 0; i < galaxies.length; i++) paintGalaxy(galaxies[i], w, h);
  }

  // Rebuild every cache that depends on the viewport size.
  function buildStatic() {
    if (!galaxies) return;
    var w = ORB.View.cssW || 1;
    var h = ORB.View.cssH || 1;
    buildBase(w, h);
    buildGalaxies(w, h);
  }

  // Soft radial blob sprite for a nebula, repainted only when its hue steps (2 deg).
  function nebulaSprite(slot, hue, sat, light, alpha) {
    var q = Math.round(wrapHue(hue) / 2);
    var n = nebulae[slot];
    if (n.q === q) return n.canvas;
    n.q = q;
    var x = n.canvas.getContext('2d');
    var c = NEB_SIZE / 2;
    var M = ORB.M;
    x.clearRect(0, 0, NEB_SIZE, NEB_SIZE);
    var g = x.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0, M.hsl(q * 2, sat, light, alpha));
    g.addColorStop(1, M.hsl(q * 2, sat, light, 0));
    x.fillStyle = g;
    x.fillRect(0, 0, NEB_SIZE, NEB_SIZE);
    return n.canvas;
  }

  // Shooting stars: occasional diagonal streak across the upper screen.
  function spawnShooter(s, w, h) {
    var M = ORB.M;
    var sp = M.rand(420, 680);
    var ang = M.rand(0.45, 0.8);
    var dir = Math.random() < 0.5 ? -1 : 1;
    s.on = true;
    s.t = 0;
    s.life = M.rand(0.7, 1.1);
    s.x = M.rand(0.1, 0.9) * w;
    s.y = M.rand(-0.1, 0.4) * h;
    s.vx = Math.cos(ang) * sp * dir;
    s.vy = Math.sin(ang) * sp;
  }

  function updateShooters(dt, w, h) {
    shootT -= dt;
    if (shootT <= 0) {
      for (var i = 0; i < shooters.length; i++) {
        if (!shooters[i].on) { spawnShooter(shooters[i], w, h); break; }
      }
      shootT = ORB.M.rand(6, 13);
    }
    for (var j = 0; j < shooters.length; j++) {
      var s = shooters[j];
      if (!s.on) continue;
      s.t += dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (s.t >= s.life) s.on = false;
    }
  }

  function drawShooters(ctx) {
    var C = ORB.CONFIG.COLORS;
    ctx.lineCap = 'round';
    for (var i = 0; i < shooters.length; i++) {
      var s = shooters[i];
      if (!s.on) continue;
      var fade = Math.min(1, s.t / 0.15) * (1 - s.t / s.life);
      var mx = s.x - s.vx * 0.05, my = s.y - s.vy * 0.05;
      var tx = s.x - s.vx * 0.14, ty = s.y - s.vy * 0.14;
      // Faint outer tail, brighter inner streak, bright head.
      ctx.strokeStyle = C.accent;
      ctx.lineWidth = 1.2;
      ctx.globalAlpha = 0.35 * fade;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(mx, my);
      ctx.stroke();
      ctx.strokeStyle = C.text;
      ctx.globalAlpha = 0.9 * fade;
      ctx.beginPath();
      ctx.moveTo(mx, my);
      ctx.lineTo(s.x, s.y);
      ctx.stroke();
      ctx.fillStyle = C.text;
      ctx.globalAlpha = fade;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 1.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ORB.Background = {
    init: function () {
      var M = ORB.M;
      layerData = LAYERS.map(function (L) {
        var arr = new Float32Array(L.count * 4);
        for (var i = 0; i < L.count; i++) {
          arr[i * 4] = Math.random();          // normalized x
          arr[i * 4 + 1] = Math.random();      // normalized y
          arr[i * 4 + 2] = L.size * (0.5 + Math.random() * 0.5);
          arr[i * 4 + 3] = Math.random() * Math.PI * 2; // twinkle phase
        }
        return arr;
      });

      motes = new Float32Array(MOTE_COUNT * 4);
      for (var m = 0; m < MOTE_COUNT; m++) {
        motes[m * 4] = Math.random();
        motes[m * 4 + 1] = Math.random();
        motes[m * 4 + 2] = M.rand(0.8, 2.0);
        motes[m * 4 + 3] = Math.random() * Math.PI * 2;
      }

      // One or two distant galaxies: tiny scroll factors make them feel far away.
      var defs = [
        { nx: M.rand(0.15, 0.4), rFrac: 0.085, factor: 0.03, hue: 42 + M.rand(-8, 8), tilt: M.rand(0.4, 0.6) },
        { nx: M.rand(0.6, 0.85), rFrac: 0.055, factor: 0.045, hue: 205 + M.rand(-8, 8), tilt: M.rand(0.35, 0.7) }
      ];
      var count = Math.random() < 0.5 ? 1 : 2;
      galaxies = [];
      for (var k = 0; k < count; k++) {
        var d = defs[k];
        d.ny = Math.random();
        d.angle = Math.random() * Math.PI * 2;
        d.spin = M.rand(-0.012, 0.012);
        galaxies.push(d);
      }

      shooters = [];
      for (var s = 0; s < SHOOTER_COUNT; s++) {
        shooters.push({ on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, life: 1 });
      }
      shootT = M.rand(2, 4);
      lastT = -1;

      nebulae = [
        { canvas: document.createElement('canvas'), q: -1 },
        { canvas: document.createElement('canvas'), q: -1 }
      ];
      nebulae[0].canvas.width = nebulae[0].canvas.height = NEB_SIZE;
      nebulae[1].canvas.width = nebulae[1].canvas.height = NEB_SIZE;

      buildStatic();
      if (!registered && ORB.View.onResize) {
        ORB.View.onResize(function () { buildStatic(); });
        registered = true;
      }
    },

    // Caller has already set ORB.View.screenTransform(ctx).
    draw: function (ctx, camY, time) {
      if (!layerData) ORB.Background.init();
      var View = ORB.View;
      var C = ORB.CONFIG.COLORS;
      var M = ORB.M;
      var w = View.cssW;
      var h = View.cssH;
      if (typeof time !== 'number') time = 0;

      // Frame time, clamped so pauses and time jumps never fling the effects.
      var dt = lastT >= 0 ? M.clamp(time - lastT, 0, 0.1) : 0;
      lastT = time;

      ctx.save();
      ctx.globalAlpha = 1;

      // Static base gradient.
      ctx.drawImage(baseCanvas, 0, 0, w, h);

      // Soft nebula blobs; hue drifts slowly with altitude. The small sprite is stretched
      // without smoothing: the gradient is so soft that blocks are invisible, and a
      // nearest-neighbour upscale is ~3x cheaper than a bilinear one.
      var hue = wrapHue(280 + camY * 0.02);
      var hue2 = wrapHue(hue + 60);
      var r = Math.max(w, h) * 0.6;
      var cy1 = h * 0.35 + wrap(camY * 0.03, h * 0.5);
      var cy2 = h * 0.75 + wrap(camY * 0.02 + h * 0.25, h * 0.5);
      var n1 = nebulaSprite(0, hue, 70, 45, 0.16);
      var n2 = nebulaSprite(1, hue2, 80, 50, 0.12);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(n1, w * 0.3 - r, cy1 - r, r * 2, r * 2);
      ctx.drawImage(n2, w * 0.8 - r * 0.8, cy2 - r * 0.8, r * 1.6, r * 1.6);
      ctx.imageSmoothingEnabled = true;

      // Distant spiral galaxies, slowly turning.
      for (var gi = 0; gi < galaxies.length; gi++) {
        var g = galaxies[gi];
        var R = g.R;
        var ext = h + R * 2;
        var gy = wrap(g.ny * ext - camY * g.factor, ext) - R;
        ctx.save();
        ctx.translate(g.nx * w, gy);
        ctx.rotate(g.angle + time * g.spin);
        ctx.drawImage(g.layer, -R, -R, R * 2, R * 2);
        ctx.restore();
      }

      // Star layers: scrolled by camY * factor, wrapped vertically, twinkling.
      ctx.fillStyle = C.text;
      for (var li = 0; li < LAYERS.length; li++) {
        var L = LAYERS[li];
        var data = layerData[li];
        var off = camY * L.factor;
        for (var i = 0; i < data.length; i += 4) {
          var x = data[i] * w;
          var y = wrap(data[i + 1] * h - off, h);
          var s = data[i + 2];
          var tw = 0.6 + 0.4 * Math.sin(time * (1.5 + li) + data[i + 3]);
          ctx.globalAlpha = L.alpha * tw;
          ctx.fillRect(x - s * 0.5, y - s * 0.5, s, s);
        }
      }

      // Dust motes: barely parallax, slow upward drift, faint shimmer.
      ctx.fillStyle = C.accent;
      for (var mi = 0; mi < MOTE_COUNT; mi++) {
        var mx = motes[mi * 4] * w;
        var my = wrap(motes[mi * 4 + 1] * h - camY * 0.08 - time * 5, h);
        var ms = motes[mi * 4 + 2];
        ctx.globalAlpha = 0.14 + 0.1 * Math.sin(time * 0.7 + motes[mi * 4 + 3]);
        ctx.fillRect(mx - ms * 0.5, my - ms * 0.5, ms, ms);
      }

      // Shooting stars.
      updateShooters(dt, w, h);
      drawShooters(ctx);

      // Vignette last, darkening the screen edges.
      ctx.globalAlpha = 1;
      ctx.drawImage(vignetteCanvas, 0, 0, w, h);
      ctx.restore();
    }
  };
})();
