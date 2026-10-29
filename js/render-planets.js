(function () {
  'use strict';
  var ORB = window.ORB = window.ORB || {};

  var TAU = Math.PI * 2, PI = Math.PI;
  var STRIPS = 28;              // longitude strips used to wrap a texture onto a sphere
  var MAX_BUILDS = 2;           // textures generated per frame (spreads the cost)

  var cache = {};               // planet id -> entry (textures, sprites, crack data)
  var shadeCache = {};          // type|size -> shared lighting overlay sprite
  var moonCache = {};           // hue bucket -> moon sprite
  var sinTab = null;            // sin of strip boundary longitudes
  var ridSeq = 0;
  var stampNo = 0;
  var builtThisFrame = 0;

  // ---------------------------------------------------------------- helpers

  // Deterministic PRNG (xorshift32).
  function seeded(seed) {
    var s = (seed >>> 0) || 1;
    return function () {
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
      s >>>= 0;
      return s / 4294967296;
    };
  }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function H(h) { return ((h % 360) + 360) % 360; }
  function hsl(h, s, l, a) {
    return 'hsla(' + Math.round(H(h)) + ',' + Math.round(s) + '%,' + Math.round(l) + '%,' + (a === undefined ? 1 : a) + ')';
  }
  function smooth(a, b, v) {
    var t = clamp((v - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  }
  function frac(v) { return v - Math.floor(v); }

  function mk(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }

  var _rgb = [0, 0, 0];
  function hslToRgb(h, s, l) {
    h = H(h) / 360; s = clamp(s, 0, 100) / 100; l = clamp(l, 0, 100) / 100;
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    function f(t) {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    }
    _rgb[0] = f(h + 1 / 3) * 255; _rgb[1] = f(h) * 255; _rgb[2] = f(h - 1 / 3) * 255;
    return _rgb;
  }

  // 256-entry RGBA colour ramp from stops [[pos, h, s, l, a?], ...].
  function makeLUT(stops) {
    var lut = new Uint8ClampedArray(256 * 4), i, k;
    for (i = 0; i < 256; i++) {
      var t = i / 255;
      k = 0;
      while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
      var a = stops[k], b = stops[k + 1];
      var u = clamp((t - a[0]) / (b[0] - a[0] || 1), 0, 1);
      var h = a[1] + (b[1] - a[1]) * u, s = a[2] + (b[2] - a[2]) * u, l = a[3] + (b[3] - a[3]) * u;
      var aa = (a[4] === undefined ? 1 : a[4]), ab = (b[4] === undefined ? 1 : b[4]);
      var rgb = hslToRgb(h, s, l);
      lut[i * 4] = rgb[0]; lut[i * 4 + 1] = rgb[1]; lut[i * 4 + 2] = rgb[2];
      lut[i * 4 + 3] = (aa + (ab - aa) * u) * 255;
    }
    return lut;
  }

  // Tileable (in u) value noise; v is 0..1 and does not wrap.
  function makeNoise(rnd, cx, cy) {
    var g = new Float32Array(cx * (cy + 1)), i;
    for (i = 0; i < g.length; i++) g[i] = rnd();
    return function (u, v) {
      var x = u * cx, y = v * cy;
      var xi = Math.floor(x), yi = Math.min(cy - 1, Math.floor(y));
      var fx = x - xi, fy = y - yi;
      fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
      var x0 = xi % cx, x1 = (x0 + 1) % cx;
      var a = g[yi * cx + x0], b = g[yi * cx + x1];
      var c = g[(yi + 1) * cx + x0], d = g[(yi + 1) * cx + x1];
      return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
    };
  }

  // Fractal noise sampled into a w*h grid (values pushed apart to roughly 0..1).
  function fbmGrid(rnd, w, h, cx, cy, oct) {
    var ns = [], o;
    for (o = 0; o < oct; o++) ns.push(makeNoise(rnd, cx << o, cy << o));
    var grid = new Float32Array(w * h), i, j;
    for (j = 0; j < h; j++) {
      var v = j / (h - 1);
      for (i = 0; i < w; i++) {
        var u = i / w, s = 0, a = 1, t = 0;
        for (o = 0; o < oct; o++) { s += a * ns[o](u, v); t += a; a *= 0.5; }
        grid[j * w + i] = clamp((s / t - 0.5) * 2.1 + 0.5, 0, 1);
      }
    }
    return grid;
  }

  // Run fn(i, j, data, offset) over a w*h canvas of pixels.
  function paint(w, h, fn) {
    var c = mk(w, h), x = c.getContext('2d');
    var id = x.createImageData(c.width, c.height), d = id.data, i, j;
    for (j = 0; j < c.height; j++) {
      for (i = 0; i < c.width; i++) fn(i, j, d, (j * c.width + i) * 4);
    }
    x.putImageData(id, 0, 0);
    return c;
  }

  // Scale a small tileable pixel canvas up into the full texture (plus the wrap pad).
  function blit(small, W, TH, pad) {
    var c = mk(W + pad, TH), x = c.getContext('2d');
    x.imageSmoothingEnabled = true;
    x.drawImage(small, 0, 0, W, TH);
    x.drawImage(small, W, 0, W, TH);
    return c;
  }

  // Emboss term from the height grid: positive where the surface faces the top-left light.
  function emboss(grid, w, h, i, j) {
    var a = grid[j * w + i];
    var b = grid[Math.min(h - 1, j + 1) * w + ((i + 1) % w)];
    return a - b;
  }

  // Draw feature fn(ox) three times so shapes crossing the seam wrap around.
  function wrapped(W, fn) { fn(-W); fn(0); fn(W); }

  function polyline(x, pts) {
    x.beginPath();
    x.moveTo(pts[0], pts[1]);
    for (var i = 2; i < pts.length; i += 2) x.lineTo(pts[i], pts[i + 1]);
  }

  // Random wandering crack, flat array [x0,y0,x1,y1,...].
  function crackPath(rnd, x0, y0, ang, segs, step) {
    var pts = [x0, y0], i;
    for (i = 0; i < segs; i++) {
      ang += (rnd() - 0.5) * 1.1;
      x0 += Math.cos(ang) * step * (0.6 + rnd() * 0.8);
      y0 += Math.sin(ang) * step * (0.6 + rnd() * 0.8);
      pts.push(x0, y0);
    }
    return pts;
  }

  // -------------------------------------------------------- texture builders
  // Each returns { surf, glow?, clouds? } canvases of size (W + pad) x TH.

  function texRocky(p, rnd, TH, W, pad) {
    var sw = Math.ceil(W / 2), sh = Math.ceil(TH / 2), hue = p.hue, i;
    var g = fbmGrid(rnd, sw, sh, 4, 3, 4);
    var sea = 0.34 + rnd() * 0.14;
    var lut = makeLUT([
      [0, hue + 40, 50, 15], [sea - 0.03, hue + 36, 55, 30], [sea, hue + 14, 50, 62],
      [sea + 0.04, hue, 48, 40], [0.7, hue - 10, 42, 48], [0.88, hue - 18, 32, 62], [1, hue - 20, 20, 84]
    ]);
    var cap = hslToRgb(hue, 18, 93).slice();
    var small = paint(sw, sh, function (ci, cj, d, o) {
      var n = g[cj * sw + ci], v = cj / (sh - 1);
      var k = Math.round(n * 255), e = 1 + emboss(g, sw, sh, ci, cj) * (n > sea ? 3.2 : 0.8);
      var r = lut[k * 4] * e, gg = lut[k * 4 + 1] * e, b = lut[k * 4 + 2] * e;
      var c = smooth(0.82, 0.95, Math.abs(v - 0.5) * 2 + (n - 0.5) * 0.25);
      d[o] = r + (cap[0] - r) * c; d[o + 1] = gg + (cap[1] - gg) * c; d[o + 2] = b + (cap[2] - b) * c;
      d[o + 3] = 255;
    });
    var surf = blit(small, W, TH, pad), x = surf.getContext('2d');
    // Craters with a lit rim on their lower-right inner wall.
    var nc = 5 + Math.floor(rnd() * 4);
    for (i = 0; i < nc; i++) {
      var cx = rnd() * W, cy = TH * (0.2 + rnd() * 0.6), cr = TH * (0.04 + rnd() * 0.07);
      wrapped(W, function (ox) {
        var gr = x.createRadialGradient(cx + ox - cr * 0.2, cy - cr * 0.2, cr * 0.1, cx + ox, cy, cr);
        gr.addColorStop(0, hsl(hue, 30, 12, 0.5));
        gr.addColorStop(0.85, hsl(hue, 30, 18, 0.4));
        gr.addColorStop(1, hsl(hue, 30, 18, 0));
        x.fillStyle = gr;
        x.beginPath(); x.arc(cx + ox, cy, cr, 0, TAU); x.fill();
        x.strokeStyle = hsl(hue, 55, 82, 0.4);
        x.lineWidth = Math.max(1, TH * 0.01);
        x.beginPath(); x.arc(cx + ox, cy, cr, 0.1, PI * 0.75); x.stroke();
      });
    }
    var out = { surf: surf };
    if (rnd() < 0.55) out.clouds = texClouds(rnd, TH, W, pad, 4, 3, 0.5, 0.78, 0.42, hue);
    return out;
  }

  function texClouds(rnd, TH, W, pad, cx, cy, lo, hi, maxA, hue) {
    var sw = Math.ceil(W / 2), sh = Math.ceil(TH / 2);
    var g = fbmGrid(rnd, sw, sh, cx, cy, 4);
    var rgb = hslToRgb(hue, 25, 96).slice();
    var small = paint(sw, sh, function (ci, cj, d, o) {
      var n = g[cj * sw + ci];
      var a = smooth(lo, hi, n) * maxA;
      var e = 1 + emboss(g, sw, sh, ci, cj) * 2.2;
      d[o] = Math.min(255, rgb[0] * e); d[o + 1] = Math.min(255, rgb[1] * e); d[o + 2] = Math.min(255, rgb[2] * e);
      d[o + 3] = a * 255;
    });
    return blit(small, W, TH, pad);
  }

  function texIce(p, rnd, TH, W, pad) {
    var sw = Math.ceil(W / 2), sh = Math.ceil(TH / 2), hue = p.hue, i;
    var g = fbmGrid(rnd, sw, sh, 3, 2, 4);
    var lut = makeLUT([[0, hue, 52, 52], [0.4, hue, 48, 70], [0.72, hue, 38, 85], [1, hue, 25, 96]]);
    var small = paint(sw, sh, function (ci, cj, d, o) {
      var n = g[cj * sw + ci], k = Math.round(n * 255), e = 1 + emboss(g, sw, sh, ci, cj) * 1.6;
      d[o] = lut[k * 4] * e; d[o + 1] = lut[k * 4 + 1] * e; d[o + 2] = lut[k * 4 + 2] * e; d[o + 3] = 255;
    });
    var surf = blit(small, W, TH, pad), x = surf.getContext('2d');
    // Frost patches.
    for (i = 0; i < 7; i++) {
      var fx = rnd() * W, fy = rnd() * TH, fr = TH * (0.1 + rnd() * 0.16);
      wrapped(W, function (ox) {
        var gr = x.createRadialGradient(fx + ox, fy, 0, fx + ox, fy, fr);
        gr.addColorStop(0, 'rgba(255,255,255,0.32)');
        gr.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = gr; x.fillRect(fx + ox - fr, fy - fr, fr * 2, fr * 2);
      });
    }
    // Pale cracks: a dark blue line with a bright twin beside it.
    x.lineCap = 'round'; x.lineJoin = 'round';
    for (i = 0; i < 10; i++) {
      var pts = crackPath(rnd, rnd() * W, rnd() * TH, rnd() * TAU, 5 + Math.floor(rnd() * 5), TH * 0.12);
      wrapped(W, function (ox) {
        var q = pts.slice(), m;
        for (m = 0; m < q.length; m += 2) q[m] += ox;
        polyline(x, q);
        x.strokeStyle = hsl(hue + 12, 65, 38, 0.55); x.lineWidth = Math.max(1.2, TH * 0.012); x.stroke();
        for (m = 1; m < q.length; m += 2) q[m] += TH * 0.008;
        polyline(x, q);
        x.strokeStyle = 'rgba(255,255,255,0.65)'; x.lineWidth = Math.max(0.8, TH * 0.007); x.stroke();
      });
    }
    return { surf: surf, clouds: texClouds(rnd, TH, W, pad, 5, 3, 0.52, 0.78, 0.55, hue) };
  }

  function texGas(p, rnd, TH, W, pad) {
    var sw = Math.ceil(W / 2), sh = Math.ceil(TH / 2), hue = p.hue, i;
    var g = fbmGrid(rnd, sw, sh, 5, 12, 4);
    var bands = 3 + rnd() * 3, ph = rnd() * 6;
    var lut = makeLUT([
      [0, hue, 55, 28], [0.25, hue + 14, 60, 45], [0.5, hue - 8, 52, 62],
      [0.75, hue + 24, 55, 44], [1, hue + 4, 48, 80]
    ]);
    var small = paint(sw, sh, function (ci, cj, d, o) {
      var v = cj / (sh - 1), n = g[cj * sw + ci];
      var val = 0.5 + 0.5 * Math.sin(TAU * (v * bands + (n - 0.5) * 1.15) + ph);
      val = 0.78 * val + 0.22 * n;
      var k = Math.round(clamp(val, 0, 1) * 255);
      var pole = 1 - 0.4 * Math.pow(Math.abs(v - 0.5) * 2, 3);
      d[o] = lut[k * 4] * pole; d[o + 1] = lut[k * 4 + 1] * pole; d[o + 2] = lut[k * 4 + 2] * pole; d[o + 3] = 255;
    });
    var surf = blit(small, W, TH, pad), x = surf.getContext('2d');
    // Great storm plus a few small eddies.
    var sx = rnd() * W, sy = TH * (0.55 + rnd() * 0.2);
    function eddy(cx, cy, rx, ry, hh, light) {
      wrapped(W, function (ox) {
        var gr = x.createRadialGradient(cx + ox, cy, 0, cx + ox, cy, rx);
        gr.addColorStop(0, hsl(hh, 70, light, 0.95));
        gr.addColorStop(0.7, hsl(hh - 15, 60, light - 18, 0.85));
        gr.addColorStop(1, hsl(hh - 15, 60, light - 18, 0));
        x.save(); x.translate(cx + ox, cy); x.scale(1, ry / rx); x.translate(-cx - ox, -cy);
        x.fillStyle = gr; x.beginPath(); x.arc(cx + ox, cy, rx, 0, TAU); x.fill();
        x.strokeStyle = hsl(hh + 10, 60, light + 18, 0.55); x.lineWidth = Math.max(1.2, rx * 0.08);
        x.beginPath(); x.arc(cx + ox, cy, rx * 0.55, 3.6, 6.9); x.stroke();
        x.beginPath(); x.arc(cx + ox, cy, rx * 0.3, 0.3, 3.6); x.stroke();
        x.restore();
      });
    }
    eddy(sx, sy, TH * 0.2, TH * 0.11, hue + 30, 62);
    for (i = 0; i < 5; i++) eddy(rnd() * W, TH * (0.15 + rnd() * 0.7), TH * (0.05 + rnd() * 0.05), TH * 0.03, hue + 15, 78);
    return { surf: surf, clouds: texClouds(rnd, TH, W, pad, 3, 8, 0.5, 0.8, 0.4, hue) };
  }

  function texLava(p, rnd, TH, W, pad) {
    var sw = Math.ceil(W / 2), sh = Math.ceil(TH / 2);
    var g = fbmGrid(rnd, sw, sh, 4, 3, 5);
    var crust = makeLUT([[0, 8, 28, 5], [0.5, 8, 24, 11], [1, 14, 20, 21]]);
    var fire = makeLUT([
      [0, 0, 100, 25, 0], [0.18, 4, 100, 34, 0.6], [0.45, 16, 100, 48, 0.92],
      [0.75, 36, 100, 60, 1], [1, 52, 100, 86, 1]
    ]);
    var surf = blit(paint(sw, sh, function (ci, cj, d, o) {
      var n = g[cj * sw + ci], k = Math.round(n * 255), e = 1 + emboss(g, sw, sh, ci, cj) * 3;
      d[o] = crust[k * 4] * e; d[o + 1] = crust[k * 4 + 1] * e; d[o + 2] = crust[k * 4 + 2] * e; d[o + 3] = 255;
    }), W, TH, pad);
    var glow = blit(paint(sw, sh, function (ci, cj, d, o) {
      var n = g[cj * sw + ci], rid = 1 - Math.abs(2 * n - 1);
      var gl = Math.max(smooth(0.8, 0.985, rid), smooth(0.28, 0.1, n));
      var k = Math.round(gl * 255);
      d[o] = fire[k * 4]; d[o + 1] = fire[k * 4 + 1]; d[o + 2] = fire[k * 4 + 2]; d[o + 3] = fire[k * 4 + 3];
    }), W, TH, pad);
    return { surf: surf, glow: glow };
  }

  function texJelly(p, rnd, TH, W, pad) {
    var sw = Math.ceil(W / 2), sh = Math.ceil(TH / 2), hue = p.hue, i;
    var g = fbmGrid(rnd, sw, sh, 3, 3, 3);
    var lut = makeLUT([[0, hue + 8, 70, 40], [0.5, hue + 12, 80, 58], [1, hue - 10, 85, 76]]);
    var surf = blit(paint(sw, sh, function (ci, cj, d, o) {
      var k = Math.round(g[cj * sw + ci] * 255);
      d[o] = lut[k * 4]; d[o + 1] = lut[k * 4 + 1]; d[o + 2] = lut[k * 4 + 2]; d[o + 3] = 255;
    }), W, TH, pad);
    var x = surf.getContext('2d');
    x.lineCap = 'round';
    // Dark veins.
    for (i = 0; i < 4; i++) {
      var pts = crackPath(rnd, rnd() * W, rnd() * TH, rnd() * TAU, 6, TH * 0.1);
      wrapped(W, function (ox) {
        var q = pts.slice(), m;
        for (m = 0; m < q.length; m += 2) q[m] += ox;
        polyline(x, q);
        x.strokeStyle = hsl(hue + 30, 80, 30, 0.28); x.lineWidth = TH * 0.025; x.stroke();
      });
    }
    // Bubbles.
    var nb = 12 + Math.floor(rnd() * 6);
    for (i = 0; i < nb; i++) {
      var bx = rnd() * W, by = TH * (0.1 + rnd() * 0.8), br = TH * (0.03 + rnd() * 0.07);
      wrapped(W, function (ox) {
        var gr = x.createRadialGradient(bx + ox, by, br * 0.2, bx + ox, by, br);
        gr.addColorStop(0, hsl(hue, 90, 85, 0.05));
        gr.addColorStop(1, hsl(hue, 90, 88, 0.4));
        x.fillStyle = gr; x.beginPath(); x.arc(bx + ox, by, br, 0, TAU); x.fill();
        x.strokeStyle = 'rgba(255,255,255,0.5)'; x.lineWidth = Math.max(1, br * 0.14);
        x.beginPath(); x.arc(bx + ox, by, br, 0, TAU); x.stroke();
        x.fillStyle = 'rgba(255,255,255,0.85)';
        x.beginPath(); x.arc(bx + ox - br * 0.38, by - br * 0.4, Math.max(0.9, br * 0.2), 0, TAU); x.fill();
      });
    }
    return { surf: surf };
  }

  function texCrumble(p, rnd, TH, W, pad) {
    var sw = Math.ceil(W / 2), sh = Math.ceil(TH / 2), hue = p.hue, i;
    var g = fbmGrid(rnd, sw, sh, 5, 4, 5);
    var lut = makeLUT([[0, hue, 18, 13], [0.5, hue + 4, 18, 30], [1, hue + 8, 16, 54]]);
    var surf = blit(paint(sw, sh, function (ci, cj, d, o) {
      var n = g[cj * sw + ci], k = Math.round(n * 255), e = 1 + emboss(g, sw, sh, ci, cj) * 4.5;
      var rid = 1 - Math.abs(2 * n - 1), dk = 1 - 0.55 * smooth(0.9, 0.99, rid);
      d[o] = lut[k * 4] * e * dk; d[o + 1] = lut[k * 4 + 1] * e * dk; d[o + 2] = lut[k * 4 + 2] * e * dk; d[o + 3] = 255;
    }), W, TH, pad);
    var x = surf.getContext('2d');
    x.lineCap = 'round'; x.lineJoin = 'round';
    for (i = 0; i < 14; i++) {
      var pts = crackPath(rnd, rnd() * W, rnd() * TH, rnd() * TAU, 4 + Math.floor(rnd() * 5), TH * 0.1);
      wrapped(W, function (ox) {
        var q = pts.slice(), m;
        for (m = 0; m < q.length; m += 2) q[m] += ox;
        polyline(x, q);
        x.strokeStyle = 'rgba(6,3,3,0.8)'; x.lineWidth = Math.max(1.3, TH * 0.014); x.stroke();
        for (m = 1; m < q.length; m += 2) q[m] += TH * 0.009;
        polyline(x, q);
        x.strokeStyle = hsl(hue, 30, 62, 0.28); x.lineWidth = Math.max(0.7, TH * 0.006); x.stroke();
      });
    }
    for (i = 0; i < 6; i++) {
      var cx = rnd() * W, cy = TH * (0.2 + rnd() * 0.6), cr = TH * (0.03 + rnd() * 0.05);
      wrapped(W, function (ox) {
        x.fillStyle = 'rgba(8,4,4,0.4)'; x.beginPath(); x.arc(cx + ox, cy, cr, 0, TAU); x.fill();
        x.strokeStyle = hsl(hue, 30, 66, 0.3); x.lineWidth = Math.max(1, TH * 0.008);
        x.beginPath(); x.arc(cx + ox, cy, cr, 0.1, PI * 0.8); x.stroke();
      });
    }
    return { surf: surf };
  }

  var BUILDERS = {
    rocky: texRocky, ice: texIce, gas: texGas, lava: texLava, jelly: texJelly, crumble: texCrumble
  };

  // ------------------------------------------------------------ sprites

  // Per-type visual constants: lighting overlay strengths, atmosphere colour, base fill.
  var STYLE = {
    rocky:   { hi: 0.10, spec: 0,    term: 0.86, halo: 0.22, rimA: 0.55 },
    ice:     { hi: 0.24, spec: 0,    term: 0.78, halo: 0.34, rimA: 0.75 },
    gas:     { hi: 0.10, spec: 0,    term: 0.84, halo: 0.30, rimA: 0.60 },
    lava:    { hi: 0.03, spec: 0,    term: 0.62, halo: 0.42, rimA: 0.50 },
    jelly:   { hi: 0.30, spec: 0.7,  term: 0.50, halo: 0.38, rimA: 0.75 },
    crumble: { hi: 0.04, spec: 0,    term: 0.84, halo: 0.12, rimA: 0.25 }
  };

  function rimColor(type, hue) {
    switch (type) {
      case 'ice': return [195, 80, 82];
      case 'lava': return [14, 100, 58];
      case 'jelly': return [hue + 20, 95, 76];
      case 'crumble': return [hue, 30, 58];
      default: return [hue, 80, 70];
    }
  }

  // Shared lighting overlay: soft terminator, limb darkening, highlight (light from top-left).
  function shadeSprite(type, SZ) {
    var key = type + '|' + SZ;
    if (shadeCache[key]) return shadeCache[key];
    var st = STYLE[type] || STYLE.rocky;
    var c = mk(SZ, SZ), x = c.getContext('2d'), R = SZ / 2, lx = R * 0.62, ly = R * 0.62, gr;
    gr = x.createRadialGradient(lx, ly, R * 0.1, lx, ly, R * 1.6);
    gr.addColorStop(0, 'rgba(6,2,22,0)');
    gr.addColorStop(0.5, 'rgba(6,2,22,0)');
    gr.addColorStop(0.78, 'rgba(6,2,22,' + (st.term * 0.5).toFixed(3) + ')');
    gr.addColorStop(1, 'rgba(6,2,22,' + st.term.toFixed(3) + ')');
    x.fillStyle = gr; x.fillRect(0, 0, SZ, SZ);
    gr = x.createRadialGradient(R, R, R * 0.65, R, R, R);
    gr.addColorStop(0, 'rgba(4,0,16,0)');
    gr.addColorStop(1, 'rgba(4,0,16,0.38)');
    x.fillStyle = gr; x.fillRect(0, 0, SZ, SZ);
    gr = x.createRadialGradient(R * 0.62, R * 0.6, 0, R * 0.62, R * 0.6, R * 0.62);
    gr.addColorStop(0, 'rgba(255,255,255,' + st.hi + ')');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr; x.fillRect(0, 0, SZ, SZ);
    if (st.spec) {
      x.fillStyle = 'rgba(255,255,255,' + st.spec + ')';
      x.beginPath(); x.ellipse(R * 0.6, R * 0.52, R * 0.2, R * 0.11, -0.6, 0, TAU); x.fill();
      x.fillStyle = 'rgba(255,255,255,' + (st.spec * 0.6) + ')';
      x.beginPath(); x.arc(R * 0.82, R * 0.8, R * 0.05, 0, TAU); x.fill();
    }
    x.globalCompositeOperation = 'destination-in';
    x.beginPath(); x.arc(R, R, R, 0, TAU); x.fill();
    shadeCache[key] = c;
    return c;
  }

  // Soft atmosphere halo, drawn behind the body (covers 0..2.4 radii).
  function haloSprite(type, hue, a) {
    var S = 128, c = mk(S, S), x = c.getContext('2d'), R = S / 2, rc = rimColor(type, hue);
    var k = 1 / 2.4;
    var gr = x.createRadialGradient(R, R, R * k * 0.8, R, R, R);
    gr.addColorStop(0, hsl(rc[0], rc[1], rc[2], a));
    gr.addColorStop(0.25, hsl(rc[0], rc[1], rc[2], a * 0.4));
    gr.addColorStop(1, hsl(rc[0], rc[1], rc[2], 0));
    x.fillStyle = gr; x.fillRect(0, 0, S, S);
    return c;
  }

  // Thin bright limb inside the disc, strongest on the lit side.
  function rimSprite(type, hue, SZ, a) {
    var c = mk(SZ, SZ), x = c.getContext('2d'), R = SZ / 2, rc = rimColor(type, hue);
    var gr = x.createRadialGradient(R, R, R * 0.74, R, R, R);
    gr.addColorStop(0, hsl(rc[0], rc[1], rc[2], 0));
    gr.addColorStop(0.75, hsl(rc[0], rc[1], rc[2], a * 0.35));
    gr.addColorStop(1, hsl(rc[0], rc[1], rc[2], a));
    x.fillStyle = gr; x.fillRect(0, 0, SZ, SZ);
    x.globalCompositeOperation = 'destination-in';
    var lg = x.createLinearGradient(0, 0, SZ, SZ);
    lg.addColorStop(0, 'rgba(0,0,0,1)'); lg.addColorStop(0.55, 'rgba(0,0,0,0.5)'); lg.addColorStop(1, 'rgba(0,0,0,0.15)');
    x.fillStyle = lg; x.fillRect(0, 0, SZ, SZ);
    x.beginPath(); x.arc(R, R, R, 0, TAU); x.fill();   // keep only the disc
    return c;
  }

  function moonSprite(hue) {
    var key = Math.round(H(hue) / 15);
    if (moonCache[key]) return moonCache[key];
    var S = 32, c = mk(S, S), x = c.getContext('2d'), R = S / 2, h = key * 15;
    var gr = x.createRadialGradient(R * 0.65, R * 0.62, R * 0.05, R, R, R);
    gr.addColorStop(0, hsl(h, 22, 88));
    gr.addColorStop(0.5, hsl(h, 25, 58));
    gr.addColorStop(1, hsl(h, 30, 14));
    x.fillStyle = gr; x.beginPath(); x.arc(R, R, R - 0.5, 0, TAU); x.fill();
    x.fillStyle = hsl(h, 25, 30, 0.45);
    x.beginPath(); x.arc(R * 1.15, R * 1.25, R * 0.22, 0, TAU); x.fill();
    x.beginPath(); x.arc(R * 0.8, R * 1.4, R * 0.14, 0, TAU); x.fill();
    moonCache[key] = c;
    return c;
  }

  // ---------------------------------------------------------- cache entries

  function makeCracks(rnd) {
    var list = [], i, n = 7;
    for (i = 0; i < n; i++) {
      var a = rnd() * TAU, d0 = rnd() * 0.25;
      var main = crackPath(rnd, Math.cos(a) * d0, Math.sin(a) * d0, a + (rnd() - 0.5), 6, 0.2);
      list.push(main);
      if (rnd() < 0.7) {
        var k = 2 * (2 + Math.floor(rnd() * 3));
        list.push(crackPath(rnd, main[k], main[k + 1], a + (rnd() - 0.5) * 2, 3, 0.16));
      }
    }
    return list;
  }

  function makeChunks(rnd) {
    var list = [], n = 8, i, j;
    for (i = 0; i < n; i++) {
      var verts = [], nv = 5 + Math.floor(rnd() * 3);
      for (j = 0; j < nv; j++) {
        var va = j / nv * TAU, vr = 0.65 + rnd() * 0.5;
        verts.push(Math.cos(va) * vr, Math.sin(va) * vr);
      }
      list.push({
        a: (i + rnd() * 0.8) / n * TAU, size: 0.12 + rnd() * 0.16, verts: verts,
        spin: (rnd() - 0.5) * 6, delay: 0.1 + 0.55 * (i / n) + rnd() * 0.06, speed: 0.8 + rnd() * 0.7
      });
    }
    return list;
  }

  function build(p, key) {
    var type = p.type;
    var builder = BUILDERS[type] || texRocky;
    var view = ORB.View || {};
    var q = Math.min(2, (view.dpr || 1.5) * (view.scale || 1));
    var TH = clamp(Math.round(p.radius * 2 * q / 8) * 8, 64, 224);
    var W = Math.round(TH * PI), pad = Math.ceil(W / (2 * STRIPS)) + 3;
    var seed = (p.seed | 0) || Math.imul(((p.id | 0) + 7), 2654435761);
    var rnd = seeded(seed ^ 0x9e3779b9);
    var tex = builder(p, rnd, TH, W, pad);
    var st = STYLE[type] || STYLE.rocky;
    var hue = p.hue || 0, i;
    var e = {
      key: key, type: type, TH: TH, W: W, pad: pad, seed: seed,
      surf: tex.surf, glow: tex.glow || null, clouds: tex.clouds || null,
      shade: shadeSprite(type, TH),
      halo: haloSprite(type, hue, st.halo),
      rim: rimSprite(type, hue, TH, st.rimA),
      cracks: null, chunks: null, sparks: null,
      base: type === 'lava' ? hsl(10, 40, 8) : (type === 'jelly' ? hsl(hue + 20, 80, 38) : hsl(hue, 40, 22)),
      tilt: -0.28 + ((seed >>> 4) % 9 - 4) * 0.045,
      phase: rnd() * TAU, nextEmber: 0, stamp: 0
    };
    if (type === 'crumble') { e.cracks = makeCracks(rnd); e.chunks = makeChunks(rnd); }
    if (type === 'ice') {
      e.sparks = [];
      for (i = 0; i < 9; i++) e.sparks.push({ lon: rnd() * TAU, v: 0.15 + rnd() * 0.7, ph: rnd() * 20 });
    }
    return e;
  }

  // -------------------------------------------------------------- drawing

  // Wrap a texture around a sphere of radius r using longitude strips.
  function drawSphere(ctx, tex, W, TH, r, rot, ov) {
    var N = STRIPS, sw = W / (2 * N), h2 = r * 2, i;
    var sx = frac((-rot - PI / 2) / TAU) * W;
    for (i = 0; i < N; i++) {
      var x0 = r * sinTab[i], x1 = r * sinTab[i + 1];
      ctx.drawImage(tex, sx, 0, sw, TH, x0, -r, x1 - x0 + ov, h2);
      sx += sw;
      if (sx >= W) sx -= W;
    }
  }

  // Tilted ring, one half at a time. back = far half (drawn before the body).
  function drawRing(ctx, p, e, back, time) {
    var r = p.radius, tilt = clamp(p.ringTilt || 0.35, 0.2, 0.5), hue = p.hue;
    var a0 = back ? PI : 0, a1 = back ? TAU : PI;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(e.tilt);
    ctx.scale(1, tilt);
    ctx.lineCap = 'butt';
    // Wide dusty band, a bright thin band, a fainter outer band.
    ctx.strokeStyle = hsl(hue + 25, 55, 62, 0.34); ctx.lineWidth = r * 0.34;
    ctx.beginPath(); ctx.arc(0, 0, r * 1.6, a0, a1); ctx.stroke();
    ctx.strokeStyle = hsl(hue + 30, 70, 82, 0.62); ctx.lineWidth = r * 0.13;
    ctx.beginPath(); ctx.arc(0, 0, r * 1.78, a0, a1); ctx.stroke();
    ctx.strokeStyle = hsl(hue + 20, 60, 72, 0.4); ctx.lineWidth = r * 0.07;
    ctx.beginPath(); ctx.arc(0, 0, r * 1.45, a0, a1); ctx.stroke();
    ctx.strokeStyle = hsl(hue + 35, 50, 88, 0.3); ctx.lineWidth = r * 0.05;
    ctx.beginPath(); ctx.arc(0, 0, r * 2.02, a0, a1); ctx.stroke();
    // A glint travelling along the ring.
    var ga = time * 0.5 + e.phase;
    ga = a0 + frac((ga - a0) / PI) * PI;
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = r * 0.13;
    ctx.beginPath(); ctx.arc(0, 0, r * 1.78, ga - 0.16, ga + 0.16); ctx.stroke();
    ctx.restore();
  }

  // Moon position relative to its planet, plus depth (+1 near, -1 far).
  var _m = { x: 0, y: 0, d: 0 };
  function moonPos(m, e) {
    var s = Math.sin(m.angle), x = Math.cos(m.angle) * m.dist, y = s * m.dist * 0.4;
    var c = Math.cos(e.tilt), sn = Math.sin(e.tilt);
    _m.x = x * c - y * sn; _m.y = x * sn + y * c; _m.d = s;
    return _m;
  }

  function drawMoons(ctx, p, e, far) {
    var ms = p.moons, i;
    if (!ms || !ms.length) return;
    for (i = 0; i < ms.length; i++) {
      var m = ms[i], pos = moonPos(m, e);
      if ((pos.d < 0) !== far) continue;
      var rr = (m.r || 3) * (1 + 0.2 * pos.d);
      var spr = moonSprite(m.hue === undefined ? p.hue : m.hue);
      ctx.globalAlpha = far ? 0.85 : 1;
      ctx.drawImage(spr, p.x + pos.x - rr, p.y + pos.y - rr, rr * 2, rr * 2);
    }
    ctx.globalAlpha = 1;
  }

  // Cracks that widen as the planet crumbles.
  function drawCracks(ctx, e, r, c) {
    var f = clamp(0.3 + c * 1.1, 0, 1), i, j, pts, n;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (var pass = 0; pass < 2; pass++) {
      ctx.beginPath();
      for (i = 0; i < e.cracks.length; i++) {
        pts = e.cracks[i];
        n = Math.max(1, Math.floor((pts.length / 2 - 1) * f));
        ctx.moveTo(pts[0] * r, pts[1] * r);
        for (j = 1; j <= n; j++) ctx.lineTo(pts[j * 2] * r, pts[j * 2 + 1] * r);
      }
      if (pass === 0) {
        ctx.strokeStyle = 'rgba(8,3,2,0.9)'; ctx.lineWidth = r * (0.02 + 0.09 * c);
      } else {
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = 'rgba(255,' + Math.round(110 + 60 * c) + ',40,' + (0.25 + 0.7 * c).toFixed(2) + ')';
        ctx.lineWidth = r * (0.01 + 0.05 * c);
      }
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawChunks(ctx, p, e, c) {
    var r = p.radius, i, j, ch;
    for (i = 0; i < e.chunks.length; i++) {
      ch = e.chunks[i];
      if (c < ch.delay) continue;
      var t = (c - ch.delay) / (1.0001 - ch.delay);
      var dist = r * (0.82 + 2.4 * ch.speed * Math.pow(t, 1.1));
      var cx = p.x + Math.cos(ch.a) * dist, cy = p.y + Math.sin(ch.a) * dist - r * 0.5 * t * t;
      var s = r * ch.size * (1 - 0.5 * t);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(ch.spin * t + ch.a);
      ctx.globalAlpha = 1 - t * t * t;
      ctx.beginPath();
      for (j = 0; j < ch.verts.length; j += 2) {
        if (j === 0) ctx.moveTo(ch.verts[0] * s, ch.verts[1] * s); else ctx.lineTo(ch.verts[j] * s, ch.verts[j + 1] * s);
      }
      ctx.closePath();
      ctx.fillStyle = hsl(p.hue, 18, 30 + 8 * (1 - t));
      ctx.fill();
      ctx.strokeStyle = hsl(p.hue, 30, 62, 0.5); ctx.lineWidth = Math.max(0.8, s * 0.15);
      ctx.stroke();
      // Hot underside while the chunk is fresh.
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(255,120,40,' + (0.5 * (1 - t)).toFixed(2) + ')';
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function drawSparkles(ctx, p, e, rot, time) {
    var r = p.radius, i, s;
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(0.7, r * 0.03);
    for (i = 0; i < e.sparks.length; i++) {
      s = e.sparks[i];
      var l = Math.atan2(Math.sin(s.lon + rot), Math.cos(s.lon + rot));
      if (Math.cos(l) < 0.2) continue;
      var tw = Math.sin(time * 2.4 + s.ph);
      if (tw < 0.5) continue;
      var x = r * Math.sin(l), y = (s.v - 0.5) * 2 * r;
      if (x * x + y * y > r * r * 0.8) continue;
      var a = (tw - 0.5) * 2, len = r * (0.06 + 0.1 * a);
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.moveTo(x - len, y); ctx.lineTo(x + len, y);
      ctx.moveTo(x, y - len); ctx.lineTo(x, y + len);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawBody(ctx, p, e, time, isCur, rot) {
    var r = p.radius, type = e.type;
    var c = (type === 'crumble' && p.crumble >= 0) ? clamp(p.crumble, 0, 1) : -1;
    var idle = (type === 'jelly' ? 0.04 : 0.008) * Math.sin(time * 2.1 + e.phase);
    var w = clamp((p.wobble || 0) + idle, -0.4, 0.4);

    ctx.save();
    ctx.translate(p.x, p.y);
    if (c > 0) {
      // Shaking, shrinking and fading as the planet falls apart.
      var sh = c * 2.2;
      ctx.translate(Math.sin(time * 61 + e.phase) * sh, Math.cos(time * 53) * sh);
      var sc = 1 - 0.16 * c * c;
      ctx.scale(sc, sc);
      if (c > 0.9) ctx.globalAlpha = Math.max(0, 1 - (c - 0.9) * 10);
    }
    var ang = p.wobbleAngle || 0;
    ctx.rotate(ang); ctx.scale(1 + w, 1 - w); ctx.rotate(-ang);

    // Opaque base so the clipped edge never shows gaps.
    ctx.fillStyle = e.base;
    ctx.beginPath(); ctx.arc(0, 0, r + 0.3, 0, TAU); ctx.fill();

    ctx.save();
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.clip();
    var a0 = ctx.globalAlpha;

    if (type === 'jelly') {
      // Drifting dark nucleus seen through the translucent skin.
      var nx = Math.sin(time * 0.8 + e.phase) * r * 0.16, ny = Math.cos(time * 0.62 + e.phase) * r * 0.14;
      var ng = ctx.createRadialGradient(nx, ny, 0, nx, ny, r * 0.55);
      ng.addColorStop(0, hsl(p.hue + 35, 90, 28, 0.9));
      ng.addColorStop(1, hsl(p.hue + 35, 90, 28, 0));
      ctx.fillStyle = ng; ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.globalAlpha = a0 * 0.84;
    }
    drawSphere(ctx, e.surf, e.W, e.TH, r, rot, 0.45);
    ctx.globalAlpha = a0;

    if (e.clouds) {
      ctx.globalAlpha = a0 * (type === 'rocky' ? 0.8 : 1);
      drawSphere(ctx, e.clouds, e.W, e.TH, r, rot * 1.5 + time * 0.03, 0);
      ctx.globalAlpha = a0;
    }

    ctx.drawImage(e.shade, -r, -r, r * 2, r * 2);

    if (e.glow) {
      // Molten cracks glow brighter and dimmer; additive so they read as light.
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = a0 * (0.62 + 0.3 * Math.sin(time * 1.9 + e.phase) + 0.08 * Math.sin(time * 5.3));
      drawSphere(ctx, e.glow, e.W, e.TH, r, rot, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = a0;
    }
    if (c >= 0 && e.cracks) drawCracks(ctx, e, r, c);
    ctx.restore();

    // Pulsing atmosphere limb.
    var pulse = 0.72 + 0.28 * Math.sin(time * 1.7 + e.phase);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = a0 * pulse * (isCur ? 1 : 0.85);
    ctx.drawImage(e.rim, -r, -r, r * 2, r * 2);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = a0;

    if (e.sparks) drawSparkles(ctx, p, e, rot, time);
    ctx.restore();
  }

  function drawHalo(ctx, p, e, time, isCur) {
    var r = p.radius, pulse = 0.74 + 0.26 * Math.sin(time * 1.7 + e.phase);
    var s = r * 2.4 * (1 + 0.025 * Math.sin(time * 1.7 + e.phase));
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = clamp(pulse * (isCur ? 1.3 : 1), 0, 1);
    ctx.drawImage(e.halo, p.x - s, p.y - s, s * 2, s * 2);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  // Lava throws a spark up now and then (rate-limited per planet).
  function emitEmbers(p, e, time) {
    var P = ORB.Particles;
    if (!P || !P.burst) return;
    if (e.nextEmber - time > 2) e.nextEmber = time;
    if (time < e.nextEmber) return;
    e.nextEmber = time + 0.3 + Math.random() * 0.5;
    var a = -PI * (0.1 + Math.random() * 0.8), r = p.radius * 0.95;
    P.burst(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, '#ff9a3c', 1, 22, 1.2, { type: 'ember', size: 2 });
  }

  // Small pulsing check mark at the upper right of a visited planet (v1 look).
  function drawMarker(ctx, p, e, time) {
    var d = p.radius + 10, ang = -PI * 0.25;
    var mx = p.x + Math.cos(ang) * d, my = p.y + Math.sin(ang) * d;
    var pulse = 0.75 + 0.25 * Math.sin(time * 2 + e.phase);
    var accent = (ORB.CONFIG && ORB.CONFIG.COLORS && ORB.CONFIG.COLORS.accent) || '#7df9ff';
    ctx.save();
    ctx.globalAlpha = 0.25 * pulse;
    ctx.fillStyle = accent;
    ctx.beginPath(); ctx.arc(mx, my, 7, 0, TAU); ctx.fill();
    ctx.globalAlpha = pulse;
    ctx.strokeStyle = accent; ctx.lineWidth = 1.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(mx - 2.6, my + 0.2); ctx.lineTo(mx - 0.6, my + 2.4); ctx.lineTo(mx + 2.9, my - 2.2);
    ctx.stroke();
    ctx.restore();
  }

  // Cheap stand-in used until a planet's textures are built (or if building fails).
  function drawFallback(ctx, p) {
    var r = p.radius, hue = p.hue || 200;
    var g = ctx.createRadialGradient(p.x - r * 0.35, p.y - r * 0.35, r * 0.05, p.x, p.y, r);
    g.addColorStop(0, hsl(hue, 80, 75));
    g.addColorStop(0.6, hsl(hue, 60, 45));
    g.addColorStop(1, hsl(hue, 50, 14));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill();
  }

  function drawStarFallback(ctx, p, time) {
    var r = p.radius, g = ctx.createRadialGradient(p.x, p.y, r * 0.3, p.x, p.y, r * 2.5);
    g.addColorStop(0, 'rgba(255,240,170,1)'); g.addColorStop(0.4, 'rgba(255,170,50,0.5)'); g.addColorStop(1, 'rgba(255,120,30,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(p.x, p.y, r * 2.5, 0, TAU); ctx.fill();
  }

  function drawHoleFallback(ctx, p) {
    var r = p.radius;
    ctx.strokeStyle = 'rgba(255,170,90,0.9)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(p.x, p.y, r * 1.3, 0, TAU); ctx.stroke();
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill();
  }

  // Drawing extent of a planet (glow, rings, moons) used for culling.
  function extent(p, type) {
    var r = p.radius;
    if (type === 'star' || type === 'blackhole') return r * 6 + 30;
    var ext = r * (p.ringed ? 2.4 : 2.4);
    if (p.moons) {
      for (var i = 0; i < p.moons.length; i++) ext = Math.max(ext, (p.moons[i].dist || 0) + 8);
    }
    return ext + 12;
  }

  function initSinTab() {
    sinTab = new Float32Array(STRIPS + 1);
    for (var i = 0; i <= STRIPS; i++) sinTab[i] = Math.sin(-PI / 2 + PI * i / STRIPS);
  }

  ORB.RenderPlanets = {
    // planets: array of Planet, world coords. currentPlanet: planet the player orbits (or null).
    draw: function (ctx, planets, time, currentPlanet) {
      if (!planets) planets = [];
      if (!sinTab) initSinTab();
      time = time || 0;
      var cam = ORB.Camera, view = ORB.View, RS = ORB.RenderSpecial;
      var i, p, key, e, type;

      // Visible rectangle in world coords (infinite when camera/view are missing).
      var minX = -Infinity, maxX = Infinity, minY = -Infinity, maxY = Infinity;
      var bMinX = minX, bMaxX = maxX, bMinY = minY, bMaxY = maxY;   // build look-ahead range
      if (cam && view && view.w > 0 && view.h > 0) {
        var z = cam.zoom || 1;
        var hw = (view.visibleW ? view.visibleW(z) : view.w / z) / 2;
        var hh = (view.visibleH ? view.visibleH(z) : view.h / z) / 2;
        minX = cam.x - hw; maxX = cam.x + hw; minY = cam.y - hh; maxY = cam.y + hh;
        bMinX = cam.x - hw * 1.3; bMaxX = cam.x + hw * 1.3; bMinY = cam.y - hh * 1.7; bMaxY = cam.y + hh * 1.5;
      }

      stampNo++;
      builtThisFrame = 0;

      ctx.save();
      ctx.setLineDash([]);

      for (i = 0; i < planets.length; i++) {
        p = planets[i];
        if (!p) continue;
        if (p.id === undefined || p.id === null) { if (!p._rid) p._rid = 'r' + (++ridSeq); key = p._rid; } else key = p.id;
        e = cache[key];
        if (e) e.stamp = stampNo;
        if (p.dead) continue;

        type = p.type || 'rocky';
        var ext = extent(p, type);
        if (p.x + ext < minX || p.x - ext > maxX || p.y + ext < minY || p.y - ext > maxY) {
          // Not on screen, but build textures a little ahead so nothing pops in.
          if (!e && type !== 'star' && type !== 'blackhole' && builtThisFrame < MAX_BUILDS &&
              p.x + ext >= bMinX && p.x - ext <= bMaxX && p.y + ext >= bMinY && p.y - ext <= bMaxY) {
            this._ensure(p, key, type);
          }
          continue;
        }

        if (type === 'star') {
          ctx.save();
          if (RS && RS.drawStar) RS.drawStar(ctx, p, time); else drawStarFallback(ctx, p, time);
          ctx.restore();
          continue;
        }
        if (type === 'blackhole') {
          ctx.save();
          if (RS && RS.drawBlackhole) RS.drawBlackhole(ctx, p, time); else drawHoleFallback(ctx, p);
          ctx.restore();
          continue;
        }

        e = e || (builtThisFrame < MAX_BUILDS ? this._ensure(p, key, type) : null);
        if (!e) { drawFallback(ctx, p); continue; }
        e.stamp = stampNo;

        var isCur = p === currentPlanet;
        var rot = (typeof p.rot === 'number') ? p.rot : time * (p.spin || (0.3 * (((p.id | 0) & 1) ? 1 : -1)));

        ctx.save();
        drawHalo(ctx, p, e, time, isCur);
        if (p.ringed) drawRing(ctx, p, e, true, time);
        drawMoons(ctx, p, e, true);
        drawBody(ctx, p, e, time, isCur, rot);
        if (p.ringed) drawRing(ctx, p, e, false, time);
        drawMoons(ctx, p, e, false);
        if (e.chunks && p.crumble > 0) drawChunks(ctx, p, e, clamp(p.crumble, 0, 1));
        if (type === 'lava') emitEmbers(p, e, time);
        if (p.visited) drawMarker(ctx, p, e, time);
        ctx.restore();
      }

      // Drop textures of planets that are no longer in the list.
      for (key in cache) {
        if (cache[key].stamp !== stampNo) delete cache[key];
      }

      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.restore();
    },

    // Build (or fetch) the cache entry for a planet; null if building failed.
    _ensure: function (p, key, type) {
      var e = cache[key];
      if (e) return e;
      builtThisFrame++;
      try {
        var q = p.type === type ? p : Object.create(p);
        if (q !== p) q.type = type;
        e = build(q, key);
        e.stamp = stampNo;
        cache[key] = e;
        return e;
      } catch (err) {
        return null;
      }
    }
  };
})();
