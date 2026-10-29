(function () {
  'use strict';
  var ORB = window.ORB = window.ORB || {};

  var tapCbs = [];
  var pauseCbs = [];
  var unlockBound = false;

  function unlockAudio() {
    try {
      if (ORB.Audio && ORB.Audio.unlock) ORB.Audio.unlock();
    } catch (e) { /* ignore */ }
  }

  function fire(list) {
    for (var i = 0; i < list.length; i++) list[i]();
  }

  ORB.Input = {
    init: function (canvas) {
      if (canvas) {
        canvas.addEventListener('pointerdown', function (e) {
          e.preventDefault();
          fire(tapCbs);
        });
        canvas.addEventListener('touchstart', function (e) {
          e.preventDefault();
        }, { passive: false });
        canvas.addEventListener('touchmove', function (e) {
          e.preventDefault();
        }, { passive: false });
        canvas.addEventListener('contextmenu', function (e) {
          e.preventDefault();
        });
      }

      window.addEventListener('keydown', function (e) {
        unlockAudio();

        var code = e.code;
        var isTap = code === 'Space' || code === 'Enter' ||
                    code === 'ArrowUp' || code === 'KeyW';
        var isPause = code === 'Escape' || code === 'KeyP';

        if (isTap) {
          if (e.repeat) return;
          var active = document.activeElement;
          // Let focused buttons handle Enter/Space natively.
          if (active && active.tagName === 'BUTTON') return;
          if (code === 'Space' || code === 'ArrowUp') e.preventDefault();
          fire(tapCbs);
        } else if (isPause) {
          if (e.repeat) return;
          fire(pauseCbs);
        }
      });

      // Any user gesture unlocks audio.
      if (!unlockBound) {
        unlockBound = true;
        document.addEventListener('pointerdown', unlockAudio, true);
      }
    },

    onTap: function (cb) {
      if (typeof cb === 'function') tapCbs.push(cb);
    },

    onPause: function (cb) {
      if (typeof cb === 'function') pauseCbs.push(cb);
    }
  };
})();
