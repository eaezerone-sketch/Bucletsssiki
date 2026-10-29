(function () {
  'use strict';
  var ORB = window.ORB = window.ORB || {};

  var handlers = {};
  var screensEl = null;
  var sections = {};      // name -> <section>
  var primary = {};       // name -> primary button
  var soundBtns = [];     // all sound toggle buttons
  var skinsEl = null;
  var currentName = null;
  var lastData = {};

  function t(key, vars) { return ORB.I18N.t(key, vars); }

  // Create element helper: el(tag, className, text)
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  function btn(cls, text, onClick) {
    var b = el('button', cls, text);
    b.type = 'button';
    b.addEventListener('click', function () {
      try { ORB.Audio.play('click'); } catch (e) { /* audio is optional */ }
      if (onClick) onClick();
    });
    return b;
  }

  function soundButton() {
    var b = btn('btn btn-ghost sound-btn', '', function () {
      var muted = handlers.onToggleSound ? handlers.onToggleSound() : ORB.Audio.toggle();
      refreshSound(muted);
    });
    soundBtns.push(b);
    return b;
  }

  function refreshSound(muted) {
    if (typeof muted !== 'boolean') muted = ORB.Audio.isMuted();
    var label = t(muted ? 'soundOff' : 'soundOn');
    for (var i = 0; i < soundBtns.length; i++) soundBtns[i].textContent = label;
  }

  function bestOf(data) {
    if (data && typeof data.best === 'number') return data.best;
    return ORB.Storage.getBest();
  }

  // ---- Skins (menu only) ----
  function renderSkins(best) {
    if (!skinsEl) return;
    skinsEl.innerHTML = '';
    var list = ORB.Skins.list;
    var selectedId = ORB.Skins.currentId();
    for (var i = 0; i < list.length; i++) {
      (function (skin) {
        var unlocked = ORB.Skins.isUnlocked(skin, best);
        var cls = 'skin';
        if (!unlocked) cls += ' locked';
        if (skin.id === selectedId) cls += ' selected';
        var b = btn(cls, '', function () {
          if (!ORB.Skins.isUnlocked(skin, ORB.Storage.getBest())) return;
          ORB.Skins.select(skin.id);
          renderSkins(bestOf(lastData));
        });
        var dot = el('span', 'skin-dot');
        dot.style.background = skin.color;
        b.appendChild(dot);
        b.appendChild(el('span', 'skin-name', ORB.Skins.name(skin)));
        if (!unlocked) b.appendChild(el('span', 'skin-lock', t('locked', { n: skin.unlock })));
        skinsEl.appendChild(b);
      })(list[i]);
    }
  }

  // ---- Build DOM ----
  function buildMenu() {
    var sec = el('section', 'screen screen-menu');
    var card = el('div', 'screen-card');
    card.appendChild(el('h1', 'game-title', t('title')));
    card.appendChild(el('p', 'subtitle', t('subtitle')));
    sec.bestStat = el('p', 'stat');
    card.appendChild(sec.bestStat);
    var play = btn('btn btn-primary', t('play'), function () { handlers.onPlay && handlers.onPlay(); });
    primary.menu = play;
    card.appendChild(play);
    card.appendChild(el('h2', 'section-title', t('skins')));
    skinsEl = el('div', 'skins');
    card.appendChild(skinsEl);
    card.appendChild(soundButton());
    sec.appendChild(card);
    return sec;
  }

  function buildPause() {
    var sec = el('section', 'screen screen-pause');
    var card = el('div', 'screen-card');
    card.appendChild(el('h2', 'screen-title', t('paused')));
    var resume = btn('btn btn-primary', t('resume'), function () { handlers.onResume && handlers.onResume(); });
    primary.pause = resume;
    card.appendChild(resume);
    card.appendChild(btn('btn', t('restart'), function () { handlers.onRestart && handlers.onRestart(); }));
    card.appendChild(btn('btn', t('menu'), function () { handlers.onMenu && handlers.onMenu(); }));
    card.appendChild(soundButton());
    sec.appendChild(card);
    return sec;
  }

  function buildOver() {
    var sec = el('section', 'screen screen-over');
    var card = el('div', 'screen-card');
    card.appendChild(el('h2', 'screen-title', t('gameOver')));
    sec.reason = el('p', 'reason');
    card.appendChild(sec.reason);
    sec.bigScore = el('div', 'big-score');
    card.appendChild(sec.bigScore);
    sec.bestStat = el('p', 'stat');
    card.appendChild(sec.bestStat);
    sec.badge = el('span', 'badge new-best hidden', t('newBest'));
    card.appendChild(sec.badge);
    sec.planetsStat = el('p', 'stat');
    card.appendChild(sec.planetsStat);
    var restart = btn('btn btn-primary', t('restart'), function () { handlers.onRestart && handlers.onRestart(); });
    primary.over = restart;
    card.appendChild(restart);
    card.appendChild(btn('btn', t('menu'), function () { handlers.onMenu && handlers.onMenu(); }));
    sec.appendChild(card);
    return sec;
  }

  // ---- Dynamic text ----
  function fillMenu(data) {
    var best = bestOf(data);
    sections.menu.bestStat.textContent = t('best') + ': ' + best;
    renderSkins(best);
    refreshSound();
  }

  function fillPause() {
    refreshSound();
  }

  function fillOver(data) {
    var d = data || {};
    var best = bestOf(d);
    sections.over.reason.textContent = t(d.reason || 'lostTime');
    sections.over.bigScore.textContent = String(d.score || 0);
    sections.over.bestStat.textContent = t('best') + ': ' + best;
    sections.over.badge.classList.toggle('hidden', !d.newBest);
    sections.over.planetsStat.textContent = t('planets') + ': ' + (d.planets || 0);
  }

  // ---- Public API ----
  function init(h) {
    handlers = h || {};
    screensEl = document.getElementById('screens');
    if (!screensEl) return;
    screensEl.innerHTML = '';
    soundBtns = [];
    sections.menu = buildMenu();
    sections.pause = buildPause();
    sections.over = buildOver();
    screensEl.appendChild(sections.menu);
    screensEl.appendChild(sections.pause);
    screensEl.appendChild(sections.over);
  }

  function show(name, data) {
    if (!sections[name]) return;
    lastData = data || {};
    if (name === 'menu') fillMenu(lastData);
    else if (name === 'pause') fillPause();
    else if (name === 'over') fillOver(lastData);

    for (var k in sections) {
      if (Object.prototype.hasOwnProperty.call(sections, k)) {
        sections[k].classList.toggle('active', k === name);
      }
    }
    screensEl.classList.add('has-active');
    currentName = name;
    if (primary[name]) {
      try { primary[name].focus(); } catch (e) { /* ignore */ }
    }
  }

  function hideAll() {
    for (var k in sections) {
      if (Object.prototype.hasOwnProperty.call(sections, k)) sections[k].classList.remove('active');
    }
    if (screensEl) screensEl.classList.remove('has-active');
    currentName = null;
  }

  function current() {
    return currentName;
  }

  ORB.Screens = {
    init: init,
    show: show,
    hideAll: hideAll,
    current: current
  };
})();
