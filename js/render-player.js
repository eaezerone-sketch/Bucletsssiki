(function () {
  'use strict';
  var ORB = window.ORB = window.ORB || {};

  var TAU = Math.PI * 2;
  var CYAN = '#7df9ff';
  var HEAT = '#ff4a2a';
  var SHIELD = '#5ab8ff';

  // ---- color helpers (hex -> cached rgb) ------------------------------------

  var rgbCache = {};

  function parse(hex) {
    var c = rgbCache[hex];
    if (c) return c;
    var h = String(hex || '#ffffff').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    c = isNaN(n) ? [255, 255, 255] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    rgbCache[hex] = c;
    return c;
  }

  function rgba(hex, a) {
    var c = parse(hex);
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  }

  // Mix two hex colors (t = 0 -> a, 1 -> b), returns an rgb() string.
  function mix(a, b, t) {
    var ca = parse(a), cb = parse(b);
    return 'rgb(' + Math.round(ca[0] + (cb[0] - ca[0]) * t) + ',' +
      Math.round(ca[1] + (cb[1] - ca[1]) * t) + ',' +
      Math.round(ca[2] + (cb[2] - ca[2]) * t) + ')';
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  // ---- cached glow sprites (cheaper than shadowBlur) -----------------------------

  var glowCache = {};

  function glowSprite(color) {
    var s = glowCache[color];
    if (s) return s;
    s = document.createElement('canvas');
    s.width = s.height = 64;
    var g = s.getContext('2d');
    var grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, rgba(color, 1));
    grad.addColorStop(0.25, rgba(color, 0.55));
    grad.addColorStop(0.6, rgba(color, 0.15));
    grad.addColorStop(1, rgba(color, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    glowCache[color] = s;
    return s;
  }

  // Additive soft glow centred on (x, y).
  function glow(ctx, color, x, y, radius, alpha) {
    if (alpha <= 0.01) return;
    ctx.globalAlpha = alpha > 1 ? 1 : alpha;
    ctx.drawImage(glowSprite(color), x - radius, y - radius, radius * 2, radius * 2);
  }

  // ---- shared per-frame state (tether lag) ----------------------------------

  var st = { planet: null, cx: 0, cy: 0, lastT: -1, ready: false };
  var tpx = [], tpy = [];   // reused tether polyline buffers
  for (var ti = 0; ti < 19; ti++) { tpx.push(0); tpy.push(0); }

  // ---- trail: tapered glowing ribbon ----------------------------------------------

  // Offset of trail point i perpendicular to the local path direction.
  function ribbonPoint(trail, n, i, p, w, side, out) {
    var a = i > 0 ? trail[i - 1] : trail[i];
    var b = i < n - 1 ? trail[i + 1] : p;
    var dx = b.x - a.x, dy = b.y - a.y;
    var l = Math.sqrt(dx * dx + dy * dy) || 1;
    var q = i < n ? trail[i] : p;
    out.x = q.x - (dy / l) * w * side;
    out.y = q.y + (dx / l) * w * side;
  }

  var tmp = { x: 0, y: 0 };

  function ribbon(ctx, trail, start, n, p, maxW) {
    // total points = n trail points + the ship itself
    var count = n - start + 1;
    var i, t, w, k;
    ctx.beginPath();
    for (i = start; i <= n; i++) {
      k = i - start;
      t = k / (count - 1);
      w = maxW * Math.pow(t, 1.35);
      ribbonPoint(trail, n, i, p, w, 1, tmp);
      if (i === start) ctx.moveTo(tmp.x, tmp.y); else ctx.lineTo(tmp.x, tmp.y);
    }
    for (i = n; i >= start; i--) {
      k = i - start;
      t = k / (count - 1);
      w = maxW * Math.pow(t, 1.35);
      ribbonPoint(trail, n, i, p, w, -1, tmp);
      ctx.lineTo(tmp.x, tmp.y);
    }
    ctx.closePath();
    ctx.fill();
  }

  function drawTrail(ctx, p, color, speedF) {
    var trail = p.trail;
    if (!trail || trail.length < 2) return;
    var n = trail.length;
    // skip anything before a teleport (wormhole) jump
    var start = 0, i, dx, dy;
    for (i = n - 1; i > 0; i--) {
      dx = trail[i].x - trail[i - 1].x;
      dy = trail[i].y - trail[i - 1].y;
      if (dx * dx + dy * dy > 90000) { start = i; break; }
    }
    if (n - start < 3) return;
    var first = trail[start];
    var orbit = p.state === 'orbit';
    var a = orbit ? 0.45 : 0.55 + 0.45 * speedF;
    var g = ctx.createLinearGradient(first.x, first.y, p.x, p.y);
    g.addColorStop(0, rgba(color, 0));
    g.addColorStop(0.5, rgba(color, 0.5 * a));
    g.addColorStop(1, rgba(color, a));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ribbon(ctx, trail, start, n, p, 3.6 + speedF * 5.5);   // soft outer
    var g2 = ctx.createLinearGradient(first.x, first.y, p.x, p.y);
    g2.addColorStop(0, 'rgba(255,255,255,0)');
    g2.addColorStop(1, 'rgba(255,255,255,' + (0.55 * a) + ')');
    ctx.fillStyle = g2;
    ribbon(ctx, trail, start, n, p, 1.3 + speedF * 1.8);   // hot core
    ctx.restore();
  }

  // ---- elastic tether -------------------------------------------------------------

  function drawTether(ctx, p, planet, color, time, heatF) {
    var dx = p.x - planet.x, dy = p.y - planet.y;
    var d = Math.sqrt(dx * dx + dy * dy) || 1;
    var nx = dx / d, ny = dy / d;
    var sr = planet.radius * (1 + (planet.wobble || 0) * 0.0);
    var sx = planet.x + nx * sr, sy = planet.y + ny * sr;     // anchor on the surface
    var stretch = p.stretch || 0;
    var taut = clamp(stretch * 3.2, 0, 1);
    var slack = 1 - taut;
    var dir = p.dir || 1;
    // motion direction in the planet frame (tangent) and its speed
    var tx = -ny * dir, ty = nx * dir;
    var rvx = p.vx - (planet.vx || 0), rvy = p.vy - (planet.vy || 0);
    var vt = rvx * tx + rvy * ty;
    var mx = (sx + p.x) * 0.5, my = (sy + p.y) * 0.5;

    // ideal control point: lags opposite to the motion, sags when slack
    var lag = clamp(vt * 0.075, -26, 26) * (0.35 + 0.65 * slack);
    var sag = slack * (3 + Math.max(0, -stretch) * 30) * Math.sin(time * 2.4 + planet.id);
    var twang = 0;
    if (p.latchT !== undefined && p.latchT < 0.9) {
      twang = Math.sin(p.latchT * 36) * Math.exp(-p.latchT * 4.5) * (8 + clamp(Math.abs(stretch), 0, 1.2) * 26);
    }
    var tgx = mx - tx * lag + nx * sag + (-ny) * twang;
    var tgy = my - ty * lag + ny * sag + nx * twang;

    // the control point chases its target (that is the visible lag)
    var dt = time - st.lastT;
    if (!(dt > 0 && dt < 0.1)) dt = 1 / 60;
    st.lastT = time;
    if (!st.ready || st.planet !== planet) {
      st.ready = true; st.planet = planet; st.cx = mx; st.cy = my;
    }
    var k = 1 - Math.exp(-dt * 13);
    st.cx += (tgx - st.cx) * k;
    st.cy += (tgy - st.cy) * k;
    // keep the bend bounded
    var ox = st.cx - mx, oy = st.cy - my, ol = Math.sqrt(ox * ox + oy * oy);
    var maxBend = 10 + d * 0.5;
    if (ol > maxBend) { st.cx = mx + ox / ol * maxBend; st.cy = my + oy / ol * maxBend; }

    // tension colour: cool cord -> white-hot -> amber when really stretched
    var over = clamp((stretch - 0.35) * 2, 0, 1);
    var cool = mix(mix(color, '#ffffff', 0.35 + taut * 0.5), '#ffc23a', over * 0.6);
    var line = heatF > 0 ? mix(color, HEAT, heatF) : cool;
    var gl = heatF > 0 ? HEAT : (over > 0.3 ? '#ffb03a' : color);

    // sample the bent cord into a polyline with a vibrating-string wave on top
    var lt = p.latchT !== undefined ? p.latchT : 9;
    var wAmp = Math.exp(-lt * 3.2) * (2 + clamp(Math.abs(stretch), 0, 1.2) * 10) * (lt < 2 ? 1 : 0);
    var wPh = lt * 46;
    var ex = p.x, ey = p.y, cx = st.cx, cy = st.cy;
    var ddx = ex - sx, ddy = ey - sy, dl = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
    var N = 18, i, u, iu, bx, by, tgx2, tgy2, tl, off;
    for (i = 0; i <= N; i++) {
      u = i / N; iu = 1 - u;
      bx = iu * iu * sx + 2 * u * iu * cx + u * u * ex;
      by = iu * iu * sy + 2 * u * iu * cy + u * u * ey;
      tgx2 = 2 * iu * (cx - sx) + 2 * u * (ex - cx);
      tgy2 = 2 * iu * (cy - sy) + 2 * u * (ey - cy);
      tl = Math.sqrt(tgx2 * tgx2 + tgy2 * tgy2) || 1;
      off = wAmp * Math.sin(u * Math.PI) * Math.sin(u * 6.28 * 1.5 + wPh);
      tpx[i] = bx - (tgy2 / tl) * off;
      tpy[i] = by + (tgx2 / tl) * off;
    }

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(tpx[0], tpy[0]);
    for (i = 1; i <= N; i++) ctx.lineTo(tpx[i], tpy[i]);
    // wide soft glow (swells with tension)
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = rgba(gl, 0.12 + 0.34 * taut);
    ctx.lineWidth = 5 + taut * 11;
    ctx.stroke();
    // body of the cord: thins out as it stretches, like a rubber band
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.7 + 0.3 * taut;
    ctx.strokeStyle = line;
    ctx.lineWidth = 2.4 + slack * 0.6 - taut * 0.6 + taut * 1.6;
    ctx.stroke();
    // rubber-band tick marks: the gaps open up as the cord stretches
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.5 + 0.5 * taut;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1 + taut * 1.4;
    ctx.setLineDash([1.5, 3.5 + clamp(stretch, 0, 1.5) * 14]);
    ctx.lineDashOffset = -(time * 40) % 64;
    ctx.stroke();
    ctx.setLineDash([]);
    // bright core when stretched
    if (taut > 0.05) {
      ctx.globalAlpha = taut * 0.9;
      ctx.lineWidth = 0.8 + taut * 0.9;
      ctx.stroke();
    }
    // anchor bead on the planet surface (flares when the band is pulled)
    glow(ctx, gl, sx, sy, 7 + taut * 8, 0.5 + 0.5 * taut);
    // glow knot at the ship end
    glow(ctx, gl, p.x, p.y, 13 + taut * 11, 0.55 + 0.45 * taut);
    ctx.restore();

    // snap ring: expanding shockwave around the ship right after the latch
    if (lt < 0.45) {
      var k = lt / 0.45, e = 1 - (1 - k) * (1 - k) * (1 - k);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = rgba(gl, 1);
      ctx.globalAlpha = (1 - k) * 0.85;
      ctx.lineWidth = 3 * (1 - k) + 0.6;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 8 + 34 * e, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
  }

  // ---- trajectory preview -----------------------------------------------------------

  function dotsAlong(ctx, pts, count, color, time, hit) {
    var spacing = 13;
    var total = 0, i;
    for (i = 1; i < count; i++) {
      total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    }
    if (total < 4) return;
    var maxLen = hit ? 420 : 300;       // keep the guide readable at high speed
    if (total > maxLen) total = maxLen;
    var flow = (time * 22) % spacing;
    var segStart = 0, dist = spacing - flow;
    for (i = 1; i < count; i++) {
      var ax = pts[i - 1].x, ay = pts[i - 1].y, bx = pts[i].x, by = pts[i].y;
      var sl = Math.hypot(bx - ax, by - ay);
      if (sl < 1e-6) continue;
      while (dist <= segStart + sl && dist <= total) {
        var f = (dist - segStart) / sl;
        var x = ax + (bx - ax) * f, y = ay + (by - ay) * f;
        var u = clamp(dist / total, 0, 1);
        var a = (1 - u * 0.85) * (hit ? 0.95 : 0.6);
        var r = 2.5 - u * 1.2;
        ctx.globalAlpha = a * 0.35;
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(x, y, r * 2.2, 0, TAU); ctx.fill();
        ctx.globalAlpha = a;
        ctx.fillStyle = hit ? '#ffffff' : color;
        ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
        dist += spacing;
      }
      segStart += sl;
    }
  }

  function drawTargetRing(ctx, planet, time) {
    var R = planet.orbitRadius || planet.radius + 26;
    var pulse = 0.5 + 0.5 * Math.sin(time * 6);
    var rr = R * (1 + 0.035 * pulse);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    glow(ctx, CYAN, planet.x, planet.y, rr + 16, 0.18 + 0.12 * pulse);
    ctx.globalAlpha = 0.55 + 0.35 * pulse;
    ctx.strokeStyle = CYAN;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(planet.x, planet.y, rr, 0, TAU);
    ctx.stroke();
    // four rotating brackets
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.9;
    var rot = time * 1.4;
    for (var i = 0; i < 4; i++) {
      var a0 = rot + i * Math.PI / 2;
      ctx.beginPath();
      ctx.arc(planet.x, planet.y, rr + 7, a0 - 0.16, a0 + 0.16);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawPreview(ctx, p, time) {
    var P = ORB.Physics;
    var res = null, v = null, pts = null, count = 0;
    if (P && P.predict && P.launchVelocity) {
      try {
        v = P.launchVelocity(p);
        res = P.predict(p.x, p.y, v.vx, v.vy,
          (ORB.Planets && ORB.Planets.list) || [], p.planet, 1.3, 1 / 30);
      } catch (e) { res = null; }
    }
    var hit = null;
    if (res && res.points && res.points.length > 1) {
      pts = res.points;
      hit = res.hit || null;
      // only the first ~1.0 s of the path (the sample step is 1/30 s)
      count = Math.min(pts.length, hit ? 36 : 27);
    } else {
      // fallback: straight tangent line
      var tx, ty;
      if (ORB.Player && ORB.Player.tangent) {
        var tg = ORB.Player.tangent(p);
        tx = tg.x; ty = tg.y;
      } else {
        var l = Math.sqrt(p.vx * p.vx + p.vy * p.vy) || 1;
        tx = p.vx / l; ty = p.vy / l;
      }
      pts = [{ x: p.x, y: p.y }, { x: p.x + tx * 150, y: p.y + ty * 150 }];
      count = 2;
    }
    var color = hit ? CYAN : '#dfe8ff';
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    dotsAlong(ctx, pts, count, color, time, !!hit);
    ctx.restore();
    if (hit) drawTargetRing(ctx, hit, time);
  }

  // ---- ship ---------------------------------------------------------------------------

  function drawFlame(ctx, r, boostT, color, time) {
    var f = clamp(boostT / 0.35, 0, 1);
    var flick = 0.85 + 0.15 * Math.sin(time * 90) + 0.1 * Math.sin(time * 53);
    var len = r * (1.6 + 5.2 * f) * flick;
    var wid = r * (0.55 + 0.35 * f);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // outer flame
    ctx.globalAlpha = 0.5 + 0.4 * f;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-r * 0.55, -wid);
    ctx.quadraticCurveTo(-r * 0.55 - len * 0.7, -wid * 0.6, -r * 0.55 - len, 0);
    ctx.quadraticCurveTo(-r * 0.55 - len * 0.7, wid * 0.6, -r * 0.55, wid);
    ctx.closePath();
    ctx.fill();
    // inner hot core
    ctx.globalAlpha = 0.7 + 0.3 * f;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(-r * 0.55, -wid * 0.5);
    ctx.quadraticCurveTo(-r * 0.55 - len * 0.35, -wid * 0.25, -r * 0.55 - len * 0.55, 0);
    ctx.quadraticCurveTo(-r * 0.55 - len * 0.35, wid * 0.25, -r * 0.55, wid * 0.5);
    ctx.closePath();
    ctx.fill();
    glow(ctx, color, -r * 0.55 - len * 0.2, 0, r * 2.2, 0.55 * f);
    ctx.restore();
  }

  function drawShip(ctx, p, color, time, speedF, heatF) {
    var r = ORB.CONFIG.PLAYER_RADIUS * 1.12;
    var rot;
    if (p.vx || p.vy) rot = Math.atan2(p.vy, p.vx);
    else if (ORB.Player && ORB.Player.tangent) { var tg = ORB.Player.tangent(p); rot = Math.atan2(tg.y, tg.x); }
    else rot = 0;

    // squash & stretch: long when fast, an elastic pop right after a latch
    var sxk = 1 + speedF * 0.42;
    var syk = 1 / Math.sqrt(sxk);
    if (p.state === 'orbit' && p.latchT !== undefined && p.latchT < 0.6) {
      var pop = Math.exp(-p.latchT * 9) * Math.sin(p.latchT * 34) * 0.3;
      sxk *= 1 - pop;
      syk *= 1 + pop;
    }

    var body = heatF > 0 ? mix('#eef6ff', HEAT, heatF * 0.8) : mix(color, '#ffffff', 0.7);
    var edge = heatF > 0 ? mix(color, HEAT, heatF) : color;

    ctx.save();
    // heat aura (behind the ship, additive)
    if (heatF > 0) {
      ctx.globalCompositeOperation = 'lighter';
      var pulse = 0.75 + 0.25 * Math.sin(time * 14);
      glow(ctx, HEAT, p.x, p.y, (16 + 16 * heatF) * pulse, 0.5 + 0.5 * heatF);
      glow(ctx, '#ffb347', p.x, p.y, 9 + 6 * heatF, 0.4 * heatF);
      ctx.globalCompositeOperation = 'source-over';
    }
    // ship glow
    ctx.globalCompositeOperation = 'lighter';
    glow(ctx, color, p.x, p.y, r * 3.2, 0.5 + 0.25 * speedF);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    ctx.translate(p.x, p.y);
    ctx.rotate(rot);
    ctx.scale(sxk, syk);

    if (p.boostT > 0 && p.state === 'fly') drawFlame(ctx, r, p.boostT, color, time);
    else if (p.state === 'fly') {
      // faint idle thruster so the ship never looks dead in flight
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.25 + 0.15 * Math.sin(time * 40);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(-r * 0.55, -r * 0.3);
      ctx.lineTo(-r * (1.5 + speedF), 0);
      ctx.lineTo(-r * 0.55, r * 0.3);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // solar panels (swept back wings)
    ctx.fillStyle = rgba(edge, 0.8);
    ctx.strokeStyle = rgba('#ffffff', 0.55);
    ctx.lineWidth = 0.7;
    var s;
    for (s = -1; s <= 1; s += 2) {
      ctx.beginPath();
      ctx.moveTo(r * 0.1, s * r * 0.35);
      ctx.lineTo(-r * 0.75, s * r * 1.75);
      ctx.lineTo(-r * 1.25, s * r * 1.55);
      ctx.lineTo(-r * 0.7, s * r * 0.35);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    // hull: a rounded dart
    ctx.fillStyle = body;
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(r * 1.55, 0);
    ctx.quadraticCurveTo(r * 0.5, -r * 0.85, -r * 0.95, -r * 0.62);
    ctx.lineTo(-r * 0.6, 0);
    ctx.lineTo(-r * 0.95, r * 0.62);
    ctx.quadraticCurveTo(r * 0.5, r * 0.85, r * 1.55, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // cockpit
    ctx.fillStyle = edge;
    ctx.beginPath();
    ctx.arc(r * 0.35, 0, r * 0.28, 0, TAU);
    ctx.fill();
    // blinking beacon
    ctx.globalAlpha = 0.5 + 0.5 * Math.sin(time * 6);
    ctx.fillStyle = ORB.CONFIG.COLORS.danger || '#ff5a5a';
    ctx.beginPath();
    ctx.arc(-r * 0.75, 0, 1.1, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  // ---- power-up effects ------------------------------------------------------------------

  function drawShield(ctx, p, time) {
    var r = ORB.CONFIG.PLAYER_RADIUS + 9 + Math.sin(time * 4) * 0.9;
    ctx.save();
    var g = ctx.createRadialGradient(p.x, p.y, r * 0.45, p.x, p.y, r);
    g.addColorStop(0, 'rgba(90,184,255,0)');
    g.addColorStop(0.75, 'rgba(90,184,255,0.12)');
    g.addColorStop(1, 'rgba(140,210,255,0.4)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = rgba(SHIELD, 0.85);
    ctx.lineWidth = 1.6;
    ctx.stroke();
    // travelling highlight arc
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    var a0 = time * 2.2;
    ctx.arc(p.x, p.y, r - 0.5, a0, a0 + 0.9);
    ctx.stroke();
    ctx.restore();
  }

  // Pulsing dashed aura plus rings drifting inward, fading as the timer runs out.
  function drawMagnet(ctx, p, time) {
    var fade = Math.min(1, p.magnetTime / 1.0);
    var pulse = 0.5 + 0.5 * Math.sin(time * 5);
    var R = ORB.CONFIG.MAGNET_RADIUS;
    var danger = ORB.CONFIG.COLORS.danger || '#ff5a8a';
    ctx.save();
    ctx.globalAlpha = (0.12 + 0.1 * pulse) * fade;
    ctx.strokeStyle = danger;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 8]);
    ctx.lineDashOffset = -time * 30;
    ctx.beginPath();
    ctx.arc(p.x, p.y, R, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    // inward-flowing rings
    ctx.lineWidth = 1.2;
    for (var i = 0; i < 2; i++) {
      var ph = (time * 0.7 + i * 0.5) % 1;
      ctx.globalAlpha = (1 - ph) * 0.22 * fade;
      ctx.beginPath();
      ctx.arc(p.x, p.y, R * (1 - ph) + 8, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---- public API ------------------------------------------------------------------------------

  ORB.RenderPlayer = {
    draw: function (ctx, player, time) {
      if (!player || player.state === 'dead') return;
      var skin = ORB.Skins.current();
      var color = skin.color;
      var trailColor = skin.trail || skin.color;
      time = time || 0;

      var maxSpeed = (ORB.CONFIG && ORB.CONFIG.MAX_SPEED) || 950;
      var speed = player.speed;
      if (speed === undefined) speed = Math.sqrt(player.vx * player.vx + player.vy * player.vy);
      var speedF = clamp(speed / maxSpeed, 0, 1);

      var orbit = player.state === 'orbit' && player.planet;
      var heatF = 0;
      if (orbit && player.planet.type === 'star' && player.planet.heat > 0.4) {
        heatF = clamp((player.planet.heat - 0.4) / 0.6, 0, 1);
      }
      if (!orbit) st.ready = false;

      ctx.save();
      drawTrail(ctx, player, trailColor, speedF);
      if (player.magnetTime > 0) drawMagnet(ctx, player, time);
      if (orbit) {
        drawPreview(ctx, player, time);
        drawTether(ctx, player, player.planet, color, time, heatF);
      }
      drawShip(ctx, player, color, time, speedF, heatF);
      if (player.shield) drawShield(ctx, player, time);
      ctx.restore();

      // leave the context clean
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;
    }
  };
})();
