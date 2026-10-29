(function () {
  'use strict';
  var ORB = window.ORB = window.ORB || {};

  // Parallax layers: [count, scroll factor, max star size, base alpha]
  var LAYERS = [
    { count: 60, factor: 0.05, size: 1.0, alpha: 0.45 },
    { count: 40, factor: 0.15, size: 1.4, alpha: 0.65 },
    { count: 25, factor: 0.3, size: 2.0, alpha: 0.9 }
  ];

  // Flat Float32Array per layer, 4 floats per star: nx, ny, size, phase.
  var layerData = null;

  function wrap(v, m) {
    return ((v % m) + m) % m;
  }

  function wrapHue(h) {
    return wrap(h, 360);
  }

  ORB.Background = {
    init: function () {
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
    },

    // Caller has already set ORB.View.screenTransform(ctx).
    draw: function (ctx, camY, time) {
      if (!layerData) this.init();
      var View = ORB.View;
      var C = ORB.CONFIG.COLORS;
      var M = ORB.M;
      var w = View.cssW;
      var h = View.cssH;

      // Base vertical gradient.
      var g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, C.bg1);
      g.addColorStop(1, C.bg2);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);

      // Soft nebula blobs; hue drifts slowly with altitude.
      var hue = wrapHue(280 + camY * 0.02);
      var hue2 = wrapHue(hue + 60);
      var r = Math.max(w, h) * 0.6;
      var cy1 = h * 0.35 + wrap(camY * 0.03, h * 0.5);
      var cy2 = h * 0.75 + wrap(camY * 0.02 + h * 0.25, h * 0.5);

      var n1 = ctx.createRadialGradient(w * 0.3, cy1, 0, w * 0.3, cy1, r);
      n1.addColorStop(0, M.hsl(hue, 70, 45, 0.16));
      n1.addColorStop(1, M.hsl(hue, 70, 45, 0));
      ctx.fillStyle = n1;
      ctx.fillRect(0, 0, w, h);

      var n2 = ctx.createRadialGradient(w * 0.8, cy2, 0, w * 0.8, cy2, r * 0.8);
      n2.addColorStop(0, M.hsl(hue2, 80, 50, 0.12));
      n2.addColorStop(1, M.hsl(hue2, 80, 50, 0));
      ctx.fillStyle = n2;
      ctx.fillRect(0, 0, w, h);

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
      ctx.globalAlpha = 1;
    }
  };
})();
