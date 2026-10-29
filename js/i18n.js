(function () {
  'use strict';
  var ORB = window.ORB = window.ORB || {};

  // Translation tables. Keys are shared with every UI module.
  var STRINGS = {
    ru: {
      title: 'ОРБИТА',
      subtitle: 'Прыгай с орбиты на орбиту',
      play: 'Играть',
      resume: 'Продолжить',
      restart: 'Заново',
      menu: 'Меню',
      paused: 'Пауза',
      gameOver: 'Орбита потеряна',
      score: 'Счёт',
      best: 'Рекорд',
      newBest: 'Новый рекорд!',
      tapHint: 'Тапни или нажми пробел, чтобы сорваться с орбиты',
      soundOn: 'Звук: вкл',
      soundOff: 'Звук: выкл',
      skins: 'Скины',
      locked: 'С {n} очков',
      perfect: 'Идеально!',
      shield: 'Щит',
      magnet: 'Магнит',
      slow: 'Замедление',
      lostTime: 'Слишком долго в пустоте',
      lostScreen: 'Улетел за край',
      lostAsteroid: 'Астероид!',
      planets: 'Планет'
    },
    en: {
      title: 'ORBITA',
      subtitle: 'Hop from orbit to orbit',
      play: 'Play',
      resume: 'Resume',
      restart: 'Restart',
      menu: 'Menu',
      paused: 'Paused',
      gameOver: 'Orbit lost',
      score: 'Score',
      best: 'Best',
      newBest: 'New best!',
      tapHint: 'Tap or press Space to break orbit',
      soundOn: 'Sound: on',
      soundOff: 'Sound: off',
      skins: 'Skins',
      locked: 'At {n} pts',
      perfect: 'Perfect!',
      shield: 'Shield',
      magnet: 'Magnet',
      slow: 'Slow',
      lostTime: 'Lost in the void',
      lostScreen: 'Flew off',
      lostAsteroid: 'Asteroid!',
      planets: 'Planets'
    }
  };

  var detected = null;

  function detectLang() {
    if (detected) return detected;
    var nav = '';
    try {
      nav = (window.navigator && (navigator.language || navigator.userLanguage)) || '';
    } catch (e) {
      nav = '';
    }
    detected = String(nav).toLowerCase().indexOf('ru') === 0 ? 'ru' : 'en';
    return detected;
  }

  ORB.I18N = {
    // Detected lazily from navigator.language on first access.
    get lang() {
      return detectLang();
    },

    // Returns the localized string for key, replacing {name} with vars.name.
    // Unknown key returns the key itself.
    t: function (key, vars) {
      var table = STRINGS[detectLang()] || STRINGS.en;
      var s = Object.prototype.hasOwnProperty.call(table, key) ? table[key] : key;
      if (vars) {
        s = String(s).replace(/\{(\w+)\}/g, function (m, name) {
          return Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : m;
        });
      }
      return s;
    }
  };
})();
