(function () {
  'use strict';
  var ORB = window.ORB = window.ORB || {};

  var STAR_COLOR = '#ffd86b';
  var ROCK_FILL = '#6b5d52';
  var ROCK_EDGE = '#a38f7e';
  var DANGER = 'rgba(255,90,90,0.6)';
  var PU_COLORS = { shield: '#4da3ff', magnet: '#ff5a5a', slow: '#5dff8a' };

  // 5-point star path centered at (cx, cy)
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

  function drawStars(ctx, stars, time) {
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      if (s.collected) continue;
      var R = s.r * (1 + 0.12 * Math.sin(time * 3 + s.phase));
      ctx.save();
      // soft gold glow
      var g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, R * 3);
      g.addColorStop(0, 'rgba(255,216,107,0.5)');
      g.addColorStop(1, 'rgba(255,216,107,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(s.x, s.y, R * 3, 0, Math.PI * 2);
      ctx.fill();
      // rotating star body
      ctx.translate(s.x, s.y);
      ctx.rotate(time * 1.5 + s.phase);
      starPath(ctx, 0, 0, R, R * 0.45);
      ctx.fillStyle = STAR_COLOR;
      ctx.shadowColor = STAR_COLOR;
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.restore();
    }
  }

  function drawAsteroids(ctx, asteroids) {
    for (var i = 0; i < asteroids.length; i++) {
      var a = asteroids[i];
      if (!a || !a.verts) continue;
      var n = a.verts.length;
      ctx.save();
      ctx.translate(a.x, a.y);
      ctx.rotate(a.rot);
      ctx.beginPath();
      for (var k = 0; k < n; k++) {
        var ang = (k / n) * Math.PI * 2;
        var rr = a.r * a.verts[k];
        var px = Math.cos(ang) * rr;
        var py = Math.sin(ang) * rr;
        if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      // red-ish warning glow around the rock
      ctx.shadowColor = DANGER;
      ctx.shadowBlur = 10;
      ctx.fillStyle = ROCK_FILL;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = ROCK_EDGE;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.restore();
    }
  }

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
      if (p.collected) continue;
      var color = PU_COLORS[p.kind] || '#ffffff';
      var pulse = 1 + 0.08 * Math.sin(time * 4 + p.phase);
      var R = p.r * pulse;
      ctx.save();
      // glowing halo
      var g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, R * 2.4);
      g.addColorStop(0, color);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, R * 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      // body
      ctx.beginPath();
      ctx.arc(p.x, p.y, R, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(8,6,20,0.85)';
      ctx.fill();
      ctx.shadowColor = color;
      ctx.shadowBlur = 10;
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.shadowBlur = 0;
      // icon
      ctx.translate(p.x, p.y);
      drawPowerIcon(ctx, p.kind, R * 0.55, color);
      ctx.restore();
    }
  }

  ORB.RenderEntities = {
    // world coords; stars/asteroids/powerups are arrays of entity objects
    draw: function (ctx, stars, asteroids, powerups, time) {
      ctx.save();
      drawStars(ctx, stars || [], time);
      drawAsteroids(ctx, asteroids || []);
      drawPowerups(ctx, powerups || [], time);
      ctx.restore();
    }
  };
})();
