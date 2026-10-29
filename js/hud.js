(function () {
  'use strict';
  var ORB = window.ORB = window.ORB || {};

  var PAUSE_SVG =
    '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">' +
    '<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/>' +
    '<rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/></svg>';

  var els = null;      // cached DOM refs, built once in init()
  var bumpTimer = 0;
  var flashTimer = 0;

  function hudEl() {
    return document.getElementById('hud');
  }

  function build(opts) {
    var hud = hudEl();
    if (!hud) return;
    hud.innerHTML = '';

    var top = document.createElement('div');
    top.className = 'hud-top';

    var score = document.createElement('div');
    score.className = 'hud-score';
    var scoreValue = document.createElement('span');
    scoreValue.className = 'hud-score-value';
    scoreValue.textContent = '0';
    var combo = document.createElement('span');
    combo.className = 'hud-combo hidden';
    score.appendChild(scoreValue);
    score.appendChild(combo);

    var pause = document.createElement('button');
    pause.className = 'icon-btn hud-pause';
    pause.setAttribute('aria-label', 'Pause');
    pause.innerHTML = PAUSE_SVG;
    pause.addEventListener('click', function () {
      if (opts && opts.onPause) opts.onPause();
    });

    top.appendChild(score);
    top.appendChild(pause);

    var powerups = document.createElement('div');
    powerups.className = 'hud-powerups';
    var puShield = document.createElement('span');
    puShield.className = 'pu pu-shield hidden';
    var puMagnet = document.createElement('span');
    puMagnet.className = 'pu pu-magnet hidden';
    var puSlow = document.createElement('span');
    puSlow.className = 'pu pu-slow hidden';
    powerups.appendChild(puShield);
    powerups.appendChild(puMagnet);
    powerups.appendChild(puSlow);

    var flash = document.createElement('div');
    flash.className = 'hud-flash';

    hud.appendChild(top);
    hud.appendChild(powerups);
    hud.appendChild(flash);

    els = {
      hud: hud,
      scoreValue: scoreValue,
      combo: combo,
      shield: puShield,
      magnet: puMagnet,
      slow: puSlow,
      flash: flash
    };
  }

  function setHidden(el, hidden) {
    if (!el) return;
    if (hidden) el.classList.add('hidden');
    else el.classList.remove('hidden');
  }

  ORB.HUD = {
    init: function (opts) {
      build(opts || {});
    },

    show: function () {
      if (els) setHidden(els.hud, false);
    },

    hide: function () {
      if (els) setHidden(els.hud, true);
    },

    setScore: function (n) {
      if (!els) return;
      els.scoreValue.textContent = String(n);
      // restart the brief "bump" animation
      els.scoreValue.classList.remove('bump');
      void els.scoreValue.offsetWidth; // force reflow so the class re-triggers
      els.scoreValue.classList.add('bump');
      clearTimeout(bumpTimer);
      bumpTimer = setTimeout(function () {
        if (els) els.scoreValue.classList.remove('bump');
      }, 250);
    },

    setCombo: function (n) {
      if (!els) return;
      if (n <= 1) {
        setHidden(els.combo, true);
        return;
      }
      els.combo.textContent = 'x' + n;
      setHidden(els.combo, false);
    },

    setPowerups: function (state) {
      if (!els || !state) return;
      var I18N = ORB.I18N;
      var shield = !!state.shield;
      var magnet = state.magnet || 0;
      var slow = state.slow || 0;

      setHidden(els.shield, !shield);
      if (shield) els.shield.textContent = I18N.t('shield');

      setHidden(els.magnet, !(magnet > 0));
      if (magnet > 0) els.magnet.textContent = I18N.t('magnet') + ' ' + Math.ceil(magnet);

      setHidden(els.slow, !(slow > 0));
      if (slow > 0) els.slow.textContent = I18N.t('slow') + ' ' + Math.ceil(slow);
    },

    flash: function (text, color) {
      if (!els) return;
      var el = els.flash;
      el.textContent = text;
      el.style.color = color || '';
      el.classList.remove('show');
      void el.offsetWidth; // force reflow so the animation restarts
      el.classList.add('show');
      clearTimeout(flashTimer);
      flashTimer = setTimeout(function () {
        if (els) els.flash.classList.remove('show');
      }, 900);
    }
  };
})();
