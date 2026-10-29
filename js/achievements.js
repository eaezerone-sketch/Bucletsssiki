(function () {
  'use strict';
  var ORB = window.ORB = window.ORB || {};

  // Persisted under ORB.Storage key 'achievements' (stored as an array of ids).
  var KEY = 'achievements';

  // Stats fields come from ORB.Score.stats(); missing fields count as 0.
  function n(v) {
    return (typeof v === 'number' && isFinite(v)) ? v : 0;
  }

  var list = [
    {
      id: 'firstSlingshot',
      name: { ru: 'Гравитационная рогатка', en: 'Gravity Slingshot' },
      desc: { ru: 'Первый разгон об планету', en: 'Your first slingshot around a planet' },
      test: function (s) { return n(s.slingshots) >= 1; }
    },
    {
      id: 'planets10',
      name: { ru: 'Космический турист', en: 'Space Tourist' },
      desc: { ru: 'Пролети 10 планет за один полёт', en: 'Hop across 10 planets in one run' },
      test: function (s) { return n(s.planets) >= 10; }
    },
    {
      id: 'planets25',
      name: { ru: 'Межпланетный курьер', en: 'Interplanetary Courier' },
      desc: { ru: '25 планет за один полёт. Посылка доставлена.', en: '25 planets in one run. Package delivered.' },
      test: function (s) { return n(s.planets) >= 25; }
    },
    {
      id: 'planets50',
      name: { ru: 'Владыка орбит', en: 'Lord of Orbits' },
      desc: { ru: 'Пятьдесят планет. Гравитация устала.', en: '50 planets in one run. Gravity is getting tired.' },
      test: function (s) { return n(s.planets) >= 50; }
    },
    {
      id: 'height500',
      name: { ru: 'Выше облаков', en: 'Above the Clouds' },
      desc: { ru: 'Поднимись на 500 м', en: 'Climb to 500 m' },
      test: function (s) { return n(s.height) >= 500; }
    },
    {
      id: 'height2000',
      name: { ru: 'Выход на орбиту', en: 'Orbit Insertion' },
      desc: { ru: 'Поднимись на 2000 м. Хьюстон, у нас высота.', en: 'Reach 2000 m. Houston, we have altitude.' },
      test: function (s) { return n(s.height) >= 2000; }
    },
    {
      id: 'comet',
      name: { ru: 'Верхом на комете', en: 'Comet Rider' },
      desc: { ru: 'Прокатись на комете и не отпускай', en: 'Ride a comet and do not let go' },
      test: function (s) { return n(s.comets) >= 1; }
    },
    {
      id: 'wormhole',
      name: { ru: 'Короткий путь', en: 'Shortcut Through Spacetime' },
      desc: { ru: 'Воспользуйся кротовой норой. Темно, зато быстро.', en: 'Use a wormhole. Dark, but quick.' },
      test: function (s) { return n(s.wormholes) >= 1; }
    },
    {
      id: 'perfect5',
      name: { ru: 'Идеальная серия', en: 'Perfect Streak' },
      desc: { ru: 'Пять идеальных прыжков подряд. Выпендрёжник.', en: 'Five perfect hops in a row. Show-off.' },
      test: function (s) { return n(s.perfectStreak) >= 5; }
    },
    {
      id: 'blackhole',
      name: { ru: 'Не стал ужином', en: 'Not Dinner Tonight' },
      desc: { ru: 'Пройди рядом с чёрной дырой и не провались', en: 'Pass a black hole and skip being its dinner' },
      test: function (s) { return n(s.blackholePasses) >= 1; }
    },
    {
      id: 'score1000',
      name: { ru: 'Тысяча с гаком', en: 'Four-Digit Club' },
      desc: { ru: 'Набери 1000 очков за один полёт', en: 'Score 1000 points in one run' },
      test: function (s) { return n(s.score) >= 1000; }
    },
    {
      id: 'stars30',
      name: { ru: 'Звездочёт', en: 'Stargazer' },
      desc: { ru: 'Собери 30 звёзд за один полёт. Карманы полны света.', en: 'Collect 30 stars in one run. Pockets full of starlight.' },
      test: function (s) { return n(s.stars) >= 30; }
    },
    {
      id: 'nearLight',
      name: { ru: 'Почти световая', en: 'Near Light Speed' },
      desc: { ru: 'Разгонись почти до предела. Физика нервничает.', en: 'Get close to top speed. Physics is nervous.' },
      test: function (s) { return n(s.maxSpeed) >= 900; }
    },
    {
      id: 'triathlon',
      name: { ru: 'Космический триатлон', en: 'Cosmic Triathlon' },
      desc: { ru: 'Рогатка, комета и кротовая нора в одном полёте', en: 'Slingshot, comet and wormhole in one run' },
      test: function (s) { return n(s.slingshots) >= 1 && n(s.comets) >= 1 && n(s.wormholes) >= 1; }
    }
  ];

  var byId = {};
  for (var i = 0; i < list.length; i++) byId[list[i].id] = list[i];

  function lang() {
    try {
      return (ORB.I18N && ORB.I18N.lang) === 'ru' ? 'ru' : 'en';
    } catch (e) {
      return 'en';
    }
  }

  // Resolve an achievement object or id string to the achievement object.
  function resolve(a) {
    if (typeof a === 'string') return byId[a] || null;
    return a || null;
  }

  // Ids stored in ORB.Storage, sanitized to known string entries.
  function readStored() {
    var v;
    try {
      v = ORB.Storage.get(KEY, []);
    } catch (e) {
      v = [];
    }
    if (!Array.isArray(v)) return [];
    var out = [];
    for (var k = 0; k < v.length; k++) {
      if (typeof v[k] === 'string' && byId[v[k]] && out.indexOf(v[k]) === -1) out.push(v[k]);
    }
    return out;
  }

  function writeStored(ids) {
    try {
      ORB.Storage.set(KEY, ids);
    } catch (e) {
      // storage unavailable; achievements still count for this session
    }
  }

  ORB.Achievements = {
    list: list,

    // Array of unlocked achievement ids.
    unlocked: function () {
      return readStored();
    },

    // Tests every still-locked achievement against stats. Persists and returns
    // the newly unlocked achievement objects (empty array if none).
    check: function (stats) {
      var fresh = [];
      if (!stats) return fresh;
      var done = readStored();
      for (var i = 0; i < list.length; i++) {
        var a = list[i];
        if (done.indexOf(a.id) !== -1) continue;
        var ok = false;
        try {
          ok = !!a.test(stats);
        } catch (e) {
          ok = false;
        }
        if (ok) {
          done.push(a.id);
          fresh.push(a);
        }
      }
      if (fresh.length) writeStored(done);
      return fresh;
    },

    // Localized name, falling back to English.
    name: function (a) {
      a = resolve(a);
      if (!a) return '';
      return a.name[lang()] || a.name.en;
    },

    // Localized description, falling back to English.
    desc: function (a) {
      a = resolve(a);
      if (!a) return '';
      return a.desc[lang()] || a.desc.en;
    },

    // { got, total } where got counts unlocked achievements from the list.
    count: function () {
      var done = readStored();
      var got = 0;
      for (var i = 0; i < list.length; i++) {
        if (done.indexOf(list[i].id) !== -1) got++;
      }
      return { got: got, total: list.length };
    }
  };
})();
