(function () {
  'use strict';
  var ORB = window.ORB = window.ORB || {};

  var PAUSE_SVG =
    '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">' +
    '<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/>' +
    '<rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/></svg>';

  var TOAST_TIME = 2600;     // ms each toast stays on screen
  var TOAST_MAX_QUEUE = 8;   // older queued toasts are dropped beyond this
  var VOID_DANGER = 0.6;

  var els = null;      // cached DOM refs, built once in init()
  var bumpTimer = 0;
  var flashTimer = 0;
  var toastTimer = 0;
  var toastQueue = [];
  var toastBusy = false;

  // Last values written to the DOM, so per-frame calls with unchanged data cost nothing.
  var last = {};
  function resetCache() {
    last = {
      score: null,
      height: null,
      combo: null,
      voidV: -1,
      voidDanger: false,
      shield: null,
      magnet: null,
      slow: null
    };
  }

  function hudEl() {
    return document.getElementById('hud');
  }

  function build(opts) {
    var hud = hudEl();
    if (!hud) return;
    hud.innerHTML = '';
    resetCache();
    clearTimeout(toastTimer);
    toastQueue = [];
    toastBusy = false;

    var top = document.createElement('div');
    top.className = 'hud-top';

    var height = document.createElement('div');
    height.className = 'hud-height';
    height.textContent = '0';

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

    top.appendChild(height);
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

    var voidEdge = document.createElement('div');
    voidEdge.className = 'hud-void';

    var toast = document.createElement('div');
    toast.className = 'hud-toast';
    var toastTitle = document.createElement('div');
    toastTitle.className = 'hud-toast-title';
    var toastText = document.createElement('div');
    toastText.className = 'hud-toast-text';
    toast.appendChild(toastTitle);
    toast.appendChild(toastText);

    hud.appendChild(top);
    hud.appendChild(powerups);
    hud.appendChild(flash);
    hud.appendChild(voidEdge);
    hud.appendChild(toast);

    els = {
      hud: hud,
      height: height,
      scoreValue: scoreValue,
      combo: combo,
      shield: puShield,
      magnet: puMagnet,
      slow: puSlow,
      flash: flash,
      voidEdge: voidEdge,
      toast: toast,
      toastTitle: toastTitle,
      toastText: toastText
    };
  }

  function setHidden(el, hidden) {
    if (!el) return;
    if (hidden) el.classList.add('hidden');
    else el.classList.remove('hidden');
  }

  function pumpToast() {
    if (!els || toastBusy || toastQueue.length === 0) return;
    var item = toastQueue.shift();
    var el = els.toast;
    els.toastTitle.textContent = item.title;
    els.toastText.textContent = item.text;
    el.classList.remove('show');
    void el.offsetWidth; // force reflow so the slide-in restarts
    el.classList.add('show');
    toastBusy = true;
    toastTimer = setTimeout(function () {
      toastTimer = 0;
      toastBusy = false;
      if (els) els.toast.classList.remove('show');
      pumpToast();
    }, TOAST_TIME);
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
      if (!els || n === last.score) return;
      last.score = n;
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

    setHeight: function (n) {
      if (!els || n === last.height) return;
      last.height = n;
      els.height.textContent = n + ' ' + ORB.I18N.t('meters');
    },

    setVoid: function (v) {
      if (!els) return;
      var x = v > 1 ? 1 : (v > 0 ? v : 0);
      if (x !== last.voidV) {
        last.voidV = x;
        els.hud.style.setProperty('--void', String(x));
      }
      var danger = x > VOID_DANGER;
      if (danger !== last.voidDanger) {
        last.voidDanger = danger;
        if (danger) els.voidEdge.classList.add('danger');
        else els.voidEdge.classList.remove('danger');
      }
    },

    setCombo: function (n) {
      if (!els || n === last.combo) return;
      last.combo = n;
      if (n <= 1) {
        setHidden(els.combo, true);
        return;
      }
      var max = (ORB.CONFIG && ORB.CONFIG.MAX_COMBO) || 5;
      var ratio = Math.min(1, n / max);
      els.combo.textContent = 'x' + n;
      els.combo.style.setProperty('--combo', String(ratio));
      setHidden(els.combo, false);
    },

    setPowerups: function (state) {
      if (!els || !state) return;
      var I18N = ORB.I18N;
      var shield = !!state.shield;
      var magnet = state.magnet || 0;
      var slow = state.slow || 0;
      // Display values change at most once per second, so compare what is shown.
      var magnetKey = magnet > 0 ? Math.ceil(magnet) : 0;
      var slowKey = slow > 0 ? Math.ceil(slow) : 0;

      if (shield !== last.shield) {
        last.shield = shield;
        setHidden(els.shield, !shield);
        if (shield) els.shield.textContent = I18N.t('shield');
      }

      if (magnetKey !== last.magnet) {
        last.magnet = magnetKey;
        setHidden(els.magnet, !(magnet > 0));
        if (magnet > 0) els.magnet.textContent = I18N.t('magnet') + ' ' + magnetKey;
      }

      if (slowKey !== last.slow) {
        last.slow = slowKey;
        setHidden(els.slow, !(slow > 0));
        if (slow > 0) els.slow.textContent = I18N.t('slow') + ' ' + slowKey;
      }
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
    },

    toast: function (title, text) {
      if (!els) return;
      toastQueue.push({ title: String(title || ''), text: String(text || '') });
      if (toastQueue.length > TOAST_MAX_QUEUE) toastQueue.shift();
      pumpToast();
    }
  };
})();
