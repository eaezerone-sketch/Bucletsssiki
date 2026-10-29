(function () {
  'use strict';
  var ORB = window.ORB = window.ORB || {};

  var PREFIX = 'orbita.';

  ORB.Storage = {
    // Read a JSON value; returns def on missing key or any failure.
    get: function (key, def) {
      try {
        var raw = window.localStorage.getItem(PREFIX + key);
        if (raw === null || raw === undefined) return def;
        return JSON.parse(raw);
      } catch (e) {
        return def;
      }
    },

    // Store a value as JSON; silently ignores failures.
    set: function (key, value) {
      try {
        window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
      } catch (e) {
        // storage unavailable (private mode, quota, blocked)
      }
    },

    // Best score as a finite number, default 0.
    getBest: function () {
      var v = this.get('best', 0);
      return (typeof v === 'number' && isFinite(v)) ? v : 0;
    },

    setBest: function (n) {
      this.set('best', n);
    }
  };
})();
