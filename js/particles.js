(function () {
  'use strict';
  var ORB = window.ORB = window.ORB || {};

  var POOL = 600;           // fixed number of particle slots, never grows
  var TWO_PI = Math.PI * 2;

  // Per-type defaults. drag: velocity damping per second. grav: px/s^2 (+y is down).
  // size: default base size. Glowing types draw with 'lighter', solid ones with 'source-over'.
  var TYPES = {
    dot:    { drag: 2.5, grav: 0,   size: 2.5, glow: true },
    spark:  { drag: 4,   grav: 0,   size: 1.6, glow: true },
    debris: { drag: 0.6, grav: 420, size: 4,   glow: false },
    smoke:  { drag: 3,   grav: -12, size: 10,  glow: false },
    ember:  { drag: 1.2, grav: -45, size: 2.4, glow: true },
    ring:   { drag: 0,   grav: 0,   size: 0,   glow: true }
  };

  // Pre-allocated slots; reused forever. No per-frame allocation.
  var pool = [];
  for (var i = 0; i < POOL; i++) {
    pool.push({
      alive: false, type: 'dot', color: '#fff', img: null,
      x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1,
      size: 1, drag: 0, grav: 0, rot: 0, spin: 0, r0: 0, r1: 0
    });
  }
  var cursor = 0;

  // Cached soft sprites (smoke blob, ember glow), keyed by kind+color.
  var SPRITE_MAX = 32;
  var sprites = {};
  var spriteCount = 0;

  function getSprite(color, kind) {
    var key = kind + color;
    var c = sprites[key];
    if (c !== undefined) return c;           // may be null if creation failed earlier
    if (spriteCount >= SPRITE_MAX) {         // keep the cache bounded
      sprites = {};
      spriteCount = 0;
    }
    c = null;
    try {
      var size = kind === 'smoke' ? 64 : 32;
      c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      var g = c.getContext('2d');
      g.fillStyle = color;
      g.fillRect(0, 0, size, size);
      // Keep the color only where the radial alpha mask is opaque.
      g.globalCompositeOperation = 'destination-in';
      var h = size / 2;
      var rg = g.createRadialGradient(h, h, 0, h, h, h);
      if (kind === 'smoke') {
        rg.addColorStop(0, 'rgba(0,0,0,0.9)');
        rg.addColorStop(0.5, 'rgba(0,0,0,0.4)');
        rg.addColorStop(1, 'rgba(0,0,0,0)');
      } else {
        rg.addColorStop(0, 'rgba(0,0,0,1)');
        rg.addColorStop(0.25, 'rgba(0,0,0,0.6)');
        rg.addColorStop(1, 'rgba(0,0,0,0)');
      }
      g.fillStyle = rg;
      g.fillRect(0, 0, size, size);
    } catch (e) {
      c = null; // no DOM/canvas available: callers fall back to plain shapes
    }
    sprites[key] = c;
    spriteCount++;
    return c;
  }

  // Random size around the base size (base 0 = type default).
  function sizeFor(type, base) {
    var r = 0.6 + Math.random() * 0.8;
    return (base || TYPES[type].size) * r;
  }

  // Take a free slot; if the pool is full, recycle the slot at the cursor.
  function alloc() {
    var n = POOL;
    for (var k = 0; k < n; k++) {
      var idx = (cursor + k) % n;
      if (!pool[idx].alive) {
        cursor = (idx + 1) % n;
        return pool[idx];
      }
    }
    var s = pool[cursor];
    cursor = (cursor + 1) % n;
    return s;
  }

  function emit(type, x, y, vx, vy, life, color, size, opts) {
    var s = alloc();
    var d = TYPES[type];
    s.alive = true;
    s.type = type;
    s.color = color;
    s.x = x;
    s.y = y;
    s.vx = vx;
    s.vy = vy;
    s.life = life;
    s.maxLife = life;
    s.size = size;
    s.drag = (opts && opts.drag != null) ? opts.drag : d.drag;
    s.grav = (opts && opts.gravity != null) ? opts.gravity : d.grav;
    s.rot = Math.random() * TWO_PI;
    s.spin = (Math.random() - 0.5) * 8;
    s.r0 = 0;
    s.r1 = 0;
    s.img = null;
    if (type === 'smoke') s.img = getSprite(color, 'smoke');
    else if (type === 'ember') s.img = getSprite(color, 'glow');
    return s;
  }

  function drawSmoke(ctx, p, t) {
    var r = p.size * (1 + 1.4 * t);
    ctx.globalAlpha = 0.55 * (1 - t);
    if (p.img) {
      ctx.drawImage(p.img, p.x - r, p.y - r, r * 2, r * 2);
    } else {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, TWO_PI);
      ctx.fill();
    }
  }

  function drawDebris(ctx, p, t) {
    var s = p.size;
    ctx.globalAlpha = 1 - t;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    // Irregular 4-gon shard: alternating long/short radii, rotating.
    for (var k = 0; k < 4; k++) {
      var rr = (k & 1) ? s * 0.55 : s;
      var ang = p.rot + k * Math.PI / 2;
      var px = p.x + Math.cos(ang) * rr;
      var py = p.y + Math.sin(ang) * rr;
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }

  function drawDot(ctx, p, t) {
    ctx.globalAlpha = 1 - t;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * (1 - 0.5 * t), 0, TWO_PI);
    ctx.fill();
  }

  function drawEmber(ctx, p, t) {
    var r = p.size * 4 * (1 - 0.3 * t);
    ctx.globalAlpha = 0.9 * (1 - t);
    if (p.img) {
      ctx.drawImage(p.img, p.x - r, p.y - r, r * 2, r * 2);
    } else {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (1 - 0.5 * t), 0, TWO_PI);
      ctx.fill();
    }
  }

  function drawSpark(ctx, p, t) {
    ctx.globalAlpha = 1 - t;
    ctx.strokeStyle = p.color;
    ctx.lineCap = 'round';
    ctx.lineWidth = p.size * (1 - 0.5 * t) + 0.4;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    // Streak trails back along the velocity; it shrinks as the spark slows.
    ctx.lineTo(p.x - p.vx * 0.05, p.y - p.vy * 0.05);
    ctx.stroke();
  }

  function drawRing(ctx, p, t) {
    ctx.globalAlpha = 1 - t;
    ctx.strokeStyle = p.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r0 + (p.r1 - p.r0) * t, 0, TWO_PI);
    ctx.stroke();
  }

  ORB.Particles = {
    reset: function () {
      for (var i = 0; i < POOL; i++) pool[i].alive = false;
      cursor = 0;
    },

    // Burst of particles flying in random directions with drag.
    // opts (optional): { type: 'dot'|'spark'|'debris'|'smoke'|'ember', gravity, size, drag }
    burst: function (x, y, color, count, speed, life, opts) {
      count = count || 16;
      speed = speed || 160;
      life = life || 0.6;
      var type = (opts && opts.type) || 'dot';
      if (!TYPES[type] || type === 'ring') type = 'dot';
      var base = (opts && opts.size) || 0;
      for (var i = 0; i < count; i++) {
        var a = Math.random() * TWO_PI;
        var s = speed * (0.4 + Math.random() * 0.6);
        emit(type, x, y, Math.cos(a) * s, Math.sin(a) * s,
          life * (0.8 + Math.random() * 0.4), color,
          sizeFor(type, base), opts);
      }
    },

    // Expanding, fading circle.
    ring: function (x, y, color, radius) {
      var r0 = radius || 10;
      var p = emit('ring', x, y, 0, 0, 0.5, color, 0, null);
      p.r0 = r0;
      p.r1 = r0 + 60;
    },

    // Chunks of rotating debris, kicked upward and falling under gravity.
    debris: function (x, y, color, count) {
      count = count || 8;
      for (var i = 0; i < count; i++) {
        var a = Math.random() * TWO_PI;
        var s = 120 + Math.random() * 160;
        emit('debris', x, y, Math.cos(a) * s, Math.sin(a) * s - 60,
          0.9 + Math.random() * 0.6, color, sizeFor('debris', 0), null);
      }
    },

    // One small soft smoke puff drifting slowly upward.
    puff: function (x, y, color) {
      emit('smoke', x, y,
        (Math.random() - 0.5) * 24, -10 - Math.random() * 20,
        0.6 + Math.random() * 0.3, color, sizeFor('smoke', 0), null);
    },

    update: function (dt) {
      for (var i = 0; i < POOL; i++) {
        var p = pool[i];
        if (!p.alive) continue;
        p.life -= dt;
        if (p.life <= 0) {
          p.alive = false;
          continue;
        }
        if (p.type === 'ring') continue;
        var k = Math.max(0, 1 - p.drag * dt);
        p.vx *= k;
        p.vy *= k;
        p.vy += p.grav * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.type === 'debris') p.rot += p.spin * dt;
      }
    },

    draw: function (ctx) {
      ctx.save();
      var i, p, t;

      // Pass 1: solid particles (smoke, debris) with normal blending.
      ctx.globalCompositeOperation = 'source-over';
      for (i = 0; i < POOL; i++) {
        p = pool[i];
        if (!p.alive) continue;
        if (p.type !== 'smoke' && p.type !== 'debris') continue;
        t = 1 - p.life / p.maxLife; // 0 at birth, 1 at death
        if (p.type === 'smoke') drawSmoke(ctx, p, t);
        else drawDebris(ctx, p, t);
      }

      // Pass 2: glowing particles with additive blending.
      ctx.globalCompositeOperation = 'lighter';
      for (i = 0; i < POOL; i++) {
        p = pool[i];
        if (!p.alive) continue;
        if (p.type === 'smoke' || p.type === 'debris') continue;
        t = 1 - p.life / p.maxLife;
        switch (p.type) {
          case 'dot': drawDot(ctx, p, t); break;
          case 'ember': drawEmber(ctx, p, t); break;
          case 'spark': drawSpark(ctx, p, t); break;
          case 'ring': drawRing(ctx, p, t); break;
        }
      }

      ctx.restore();
    }
  };
})();
