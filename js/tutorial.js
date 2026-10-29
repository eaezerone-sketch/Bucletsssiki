(function () {
  'use strict';
  var ORB = window.ORB = window.ORB || {};

  var built = false;

  // Returns the #tutorial container (looked up lazily, never at load time).
  function root() {
    return document.getElementById('tutorial');
  }

  ORB.Tutorial = {
    // True until the player has finished the tutorial once.
    shouldShow: function () {
      return !ORB.Storage.get('tutorialDone', false);
    },

    // Builds the hint DOM once and shows it.
    show: function () {
      var el = root();
      if (!el) return;
      if (!built) {
        el.innerHTML = '';
        var hint = document.createElement('div');
        hint.className = 'tutorial-hint';

        var icon = document.createElement('div');
        icon.className = 'tap-icon';

        var text = document.createElement('p');
        text.textContent = ORB.I18N.t('tapHint');

        hint.appendChild(icon);
        hint.appendChild(text);
        el.appendChild(hint);
        built = true;
      }
      el.classList.add('show');
    },

    // Hides the hint without marking the tutorial as done.
    hide: function () {
      var el = root();
      if (el) el.classList.remove('show');
    },

    // Hides the hint and remembers that the tutorial was completed.
    done: function () {
      this.hide();
      ORB.Storage.set('tutorialDone', true);
    }
  };
})();
