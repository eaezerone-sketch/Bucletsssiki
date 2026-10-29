(function () {
  'use strict';
  var ORB = window.ORB = window.ORB || {};

  // Translation tables. Keys are shared with every UI module.
  var STRINGS = {
    ru: {
      title: 'ОРБИТА',
      subtitle: 'Цепляйся за орбиты, лови гравитацию',
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
      planets: 'Планет',
      height: 'Высота',
      meters: 'м',
      slingshot: 'Гравиманёвр!',
      cometRide: 'Комета!',
      warp: 'Червоточина!',
      nearMiss: 'На волоске!',
      lostVoid: 'Тьма догнала',
      lostStar: 'Сгорел у звезды',
      lostBlackhole: 'Поглощён чёрной дырой',
      achievements: 'Достижения',
      achievementUnlocked: 'Новое достижение',
      back: 'Назад',
      stars: 'Звёзды',
      slingshots: 'Манёвры',
      comets: 'Кометы',
      wormholes: 'Червоточины',
      heat: 'Перегрев!',
      crumbling: 'Планета рушится!',
      voidNear: 'Тьма близко!',
      tutGravity: 'Планеты притягивают — используй гравитацию, чтобы изогнуть полёт',
      tutVoid: 'Снизу поднимается тьма — не останавливайся!',
      tutStar: 'Звезда перегревает — улетай быстрее',
      tutBlackhole: 'Чёрная дыра! Пролети рядом ради бонуса, но не попадись',
      tutCrumble: 'Эта планета рассыпается — прыгай дальше',
      latched: 'Пойман!'
    },
    en: {
      title: 'ORBITA',
      subtitle: 'Latch onto orbits, ride the gravity',
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
      planets: 'Planets',
      height: 'Height',
      meters: 'm',
      slingshot: 'Gravity assist!',
      cometRide: 'Comet!',
      warp: 'Wormhole!',
      nearMiss: 'Close call!',
      lostVoid: 'Swallowed by the void',
      lostStar: 'Burned up by the star',
      lostBlackhole: 'Swallowed by a black hole',
      achievements: 'Achievements',
      achievementUnlocked: 'New achievement',
      back: 'Back',
      stars: 'Stars',
      slingshots: 'Slingshots',
      comets: 'Comets',
      wormholes: 'Wormholes',
      heat: 'Overheating!',
      crumbling: 'Planet crumbling!',
      voidNear: 'Void is close!',
      tutGravity: 'Planets pull on you: use gravity to bend your flight',
      tutVoid: 'The void is rising from below. Don\'t stop!',
      tutStar: 'The star is overheating you. Get away faster',
      tutBlackhole: 'Black hole! Fly close for a bonus, but don\'t get caught',
      tutCrumble: 'This planet is crumbling. Keep jumping',
      latched: 'Latched!'
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
