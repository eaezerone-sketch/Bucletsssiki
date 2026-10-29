(function () {
  'use strict';
  var ORB = window.ORB = window.ORB || {};

  // Fading trail: each segment gets more opaque and thicker toward the satellite.
  function drawTrail(ctx, trail, color) {
    var n = trail.length;
    if (n < 2) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.strokeStyle = color;
    for (var i = 1; i < n; i++) {
      var t = i / n;
      ctx.globalAlpha = t * 0.7;
      ctx.lineWidth = 0.8 + t * 2.2;
      ctx.beginPath();
      ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
      ctx.lineTo(trail[i].x, trail[i].y);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Small glowing body with two solar panels, rotated along the velocity.
  function drawSatellite(ctx, p, color, time) {
    var r = ORB.CONFIG.PLAYER_RADIUS;
    var rot = (p.vx || p.vy) ? Math.atan2(p.vy, p.vx) : 0;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(rot);
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    // solar panels
    ctx.fillStyle = 'rgba(125, 249, 255, 0.85)';
    ctx.fillRect(-2 * r, -r * 0.45, r * 0.9, r * 0.9);
    ctx.fillRect(r * 1.1, -r * 0.45, r * 0.9, r * 0.9);
    // panel struts
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-r * 1.1, 0);
    ctx.lineTo(-r * 0.5, 0);
    ctx.moveTo(r * 0.5, 0);
    ctx.lineTo(r * 1.1, 0);
    ctx.stroke();
    // body
    ctx.fillStyle = ORB.CONFIG.COLORS.text;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.55, 0, Math.PI * 2);
    ctx.fill();
    // blinking light
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.5 + 0.5 * Math.sin(time * 6);
    ctx.fillStyle = ORB.CONFIG.COLORS.danger;
    ctx.beginPath();
    ctx.arc(0, -r * 0.55, 1.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawShield(ctx, p, time) {
    var r = ORB.CONFIG.PLAYER_RADIUS + 7 + Math.sin(time * 4) * 0.8;
    ctx.save();
    ctx.shadowColor = '#5ab8ff';
    ctx.shadowBlur = 14;
    ctx.strokeStyle = 'rgba(90, 184, 255, 0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(90, 184, 255, 0.12)';
    ctx.fill();
    ctx.restore();
  }

  // Pulsing dashed magnet aura, fades out as the magnet timer runs down.
  function drawMagnet(ctx, p, time) {
    var fade = Math.min(1, p.magnetTime / 1.0);
    var pulse = 0.5 + 0.5 * Math.sin(time * 5);
    ctx.save();
    ctx.globalAlpha = (0.12 + 0.1 * pulse) * fade;
    ctx.strokeStyle = ORB.CONFIG.COLORS.danger;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 8]);
    ctx.lineDashOffset = -time * 30;
    ctx.beginPath();
    ctx.arc(p.x, p.y, ORB.CONFIG.MAGNET_RADIUS, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // Dashed aim guide along the orbit tangent, fading out with distance.
  function drawAimGuide(ctx, p, color) {
    var t = ORB.Player.tangent(p);
    var len = 110;
    var ex = p.x + t.x * len;
    var ey = p.y + t.y * len;
    ctx.save();
    var g = ctx.createLinearGradient(p.x, p.y, ex, ey);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.strokeStyle = g;
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  ORB.RenderPlayer = {
    draw: function (ctx, player, time) {
      if (!player || player.state === 'dead') return;
      var skin = ORB.Skins.current();
      var color = skin.color;
      var trailColor = skin.trail || skin.color;

      ctx.save();
      drawTrail(ctx, player.trail || [], trailColor);

      if (player.magnetTime > 0) drawMagnet(ctx, player, time);
      if (player.state === 'orbit') drawAimGuide(ctx, player, color);
      drawSatellite(ctx, player, color, time);
      if (player.shield) drawShield(ctx, player, time);

      ctx.restore();
      ctx.setLineDash([]);
    }
  };
})();
