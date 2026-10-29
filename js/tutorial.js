(function () {
  'use strict';
  var ORB = window.ORB = window.ORB || {};

  // Seconds a step hint stays on screen before auto-hiding.
  var HIDE_AFTER = 3.2;

  // Step name -> i18n key of its text. 'launch' is the tap hint (has the tap icon).
  var KEYS = {
    launch: 'tapHint',
    gravity: 'tutGravity',
    void: 'tutVoid',
    star: 'tutStar',
    blackhole: 'tutBlackhole',
    crumble: 'tutCrumble'
  };

  var built = false;
  var textEl = null;   // the <p> inside the hint
  var timer = null;    // auto-hide timeout handle (step hints only)
  var current = null;  // name of the hint currently visible, or null
  var queued = null;   // at most one step name waiting for the screen to clear

  // Returns the #tutorial container (looked up lazily, never at load time).
  function root() {
    return document.getElementById('tutorial');
  }

  // Seen-set of one-time step names, stored under 'tutorialSeen'.
  function getSeen() {
    try {
      var s = ORB.Storage.get('tutorialSeen', {});
      return (s && typeof s === 'object') ? s : {};
    } catch (e) {
      return {};
    }
  }

  function markSeen(name) {
    try {
      var s = getSeen();
      s[name] = true;
      ORB.Storage.set('tutorialSeen', s);
    } catch (e) {
      // storage unavailable: the hint may repeat, which is harmless
    }
  }

  // Builds the hint DOM once. Returns false when there is no container.
  function build(el) {
    if (built) return true;
    el.innerHTML = '';
    var hint = document.createElement('div');
    hint.className = 'tutorial-hint';

    var icon = document.createElement('div');
    icon.className = 'tap-icon';

    textEl = document.createElement('p');

    hint.appendChild(icon);
    hint.appendChild(textEl);
    el.appendChild(hint);
    built = true;
    return true;
  }

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  // Puts the text of hint `name` on screen. Returns false when there is no container.
  function render(name) {
    var el = root();
    if (!el) return false;
    build(el);
    textEl.textContent = ORB.I18N.t(KEYS[name]);
    if (name === 'launch') {
      el.classList.remove('no-icon');
    } else {
      el.classList.add('no-icon');
    }
    el.classList.add('show');
    current = name;
    return true;
  }

  // Hides whatever is visible right now.
  function hideNow() {
    clearTimer();
    current = null;
    var el = root();
    if (el) el.classList.remove('show');
  }

  // Shows the queued step, if nothing else is visible.
  function drain() {
    if (current !== null || queued === null) return;
    var name = queued;
    queued = null;
    if (!getSeen()[name]) startStep(name);
  }

  // Shows a one-time step hint and schedules its auto-hide.
  function startStep(name) {
    if (!render(name)) return;
    markSeen(name);
    clearTimer();
    timer = setTimeout(function () {
      timer = null;
      hideNow();
      drain();
    }, HIDE_AFTER * 1000);
  }

  ORB.Tutorial = {
    // True until the player has finished the tutorial once.
    shouldShow: function () {
      return !ORB.Storage.get('tutorialDone', false);
    },

    // Shows the persistent 'launch' tap hint (stays until done()).
    show: function () {
      if (!root()) return;
      clearTimer();
      render('launch');
    },

    // Hides the hint without marking the tutorial as done.
    hide: function () {
      hideNow();
    },

    // Hides the hint and remembers that the tutorial was completed.
    done: function () {
      hideNow();
      ORB.Storage.set('tutorialDone', true);
      drain();
    },

    // Shows the one-time hint `name` (once ever, auto-hides after 3.2 s).
    // Does not interrupt a visible hint: it is queued (at most one waits).
    step: function (name) {
      if (!Object.prototype.hasOwnProperty.call(KEYS, name)) return;
      if (!root()) return;
      if (getSeen()[name]) return;
      if (current === name) return;
      if (current !== null) {
        if (queued === null) queued = name;
        return;
      }
      startStep(name);
    }
  };
})();
