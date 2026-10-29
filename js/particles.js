(function () {
  'use strict';
  var ORB = window.ORB = window.ORB || {};

  var MAX = 500;
  var list = [];

  function push(p) {
    if (list.length >= MAX) list.shift(); // drop oldest when over the cap
    list.push(p);
  }

  ORB.Particles = {
    reset: function () {
      list.length = 0;
    },

    // Burst of dots flying in random directions with slight drag.
    burst: function (x, y, color, count, speed, life) {
      count = count || 16;
      speed = speed || 160;
      life = life || 0.6;
      for (var i = 0; i < count; i++) {
        var a = Math.random() * Math.PI * 2;
        var s = speed * (0.4 + Math.random() * 0.6);
        push({
          type: 'dot',
          x: x,
          y: y,
          vx: Math.cos(a) * s,
          vy: Math.sin(a) * s,
          life: life,
          maxLife: life,
          size: 1.5 + Math.random() * 2,
          color: color
        });
      }
    },

    // Expanding, fading circle.
    ring: function (x, y, color, radius) {
      var r0 = radius || 10;
      push({
        type: 'ring',
        x: x,
        y: y,
        vx: 0,
        vy: 0,
        life: 0.5,
        maxLife: 0.5,
        r0: r0,
        r1: r0 + 60,
        color: color
      });
    },

    update: function (dt) {
      for (var i = list.length - 1; i >= 0; i--) {
        var p = list[i];
        p.life -= dt;
        if (p.life <= 0) {
          list.splice(i, 1);
          continue;
        }
        if (p.type === 'dot') {
          var drag = Math.max(0, 1 - 2.5 * dt);
          p.vx *= drag;
          p.vy *= drag;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
        }
      }
    },

    draw: function (ctx) {
      if (!list.length) return;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (var i = 0; i < list.length; i++) {
        var p = list[i];
        var t = 1 - p.life / p.maxLife; // 0 at birth, 1 at death
        ctx.globalAlpha = Math.max(0, 1 - t);
        ctx.fillStyle = p.color;
        ctx.strokeStyle = p.color;
        if (p.type === 'dot') {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (1 - 0.5 * t), 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r0 + (p.r1 - p.r0) * t, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  };
})();
