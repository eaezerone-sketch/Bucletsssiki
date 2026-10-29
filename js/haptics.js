(function () {
  'use strict';
  var ORB = window.ORB = window.ORB || {};

  // Vibration feedback. Persisted user toggle under the 'haptics' key (default on).
  var KEY = 'haptics';

  ORB.Haptics = {
    // Vibrate with a pattern (ms number or array). Silent no-op when unsupported or disabled.
    buzz: function (pattern) {
      try {
        if (!this.isEnabled()) return;
        if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
        navigator.vibrate(pattern);
      } catch (e) {
        // Vibration is optional; ignore any failure.
      }
    },

    setEnabled: function (b) {
      try {
        ORB.Storage.set(KEY, !!b);
      } catch (e) {
        // Storage failures are ignored; the setting just won't persist.
      }
    },

    isEnabled: function () {
      try {
        return ORB.Storage.get(KEY, true) !== false;
      } catch (e) {
        return true;
      }
    }
  };
})();
