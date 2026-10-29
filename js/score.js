(function () {
  'use strict';
  var ORB = window.ORB = window.ORB || {};

  // Read a CONFIG number with a fallback, so a missing key never yields NaN.
  function cfg(key, fallback) {
    var C = ORB.CONFIG || {};
    return typeof C[key] === 'number' ? C[key] : fallback;
  }

  // Points for each bonus kind (before combo multiplier) and the counter it increments.
  var BONUS = {
    slingshot: { key: 'SLINGSHOT_POINTS', fallback: 25, counter: 'slingshots' },
    comet:     { key: 'COMET_POINTS',     fallback: 15, counter: 'comets' },
    wormhole:  { key: 'WORMHOLE_POINTS',  fallback: 20, counter: 'wormholes' },
    nearMiss:  { key: null,               fallback: 10, counter: null }
  };

  ORB.Score = {
    value: 0,
    combo: 1,
    planets: 0,
    stars: 0,
    height: 0,
    slingshots: 0,
    comets: 0,
    wormholes: 0,
    perfectStreak: 0, // best perfect-capture streak this run
    streak: 0,        // current perfect-capture streak
    blackholePasses: 0,
    maxSpeed: 0,

    reset: function () {
      this.value = 0;
      this.combo = 1;
      this.planets = 0;
      this.stars = 0;
      this.height = 0;
      this.slingshots = 0;
      this.comets = 0;
      this.wormholes = 0;
      this.perfectStreak = 0;
      this.streak = 0;
      this.blackholePasses = 0;
      this.maxSpeed = 0;
    },

    // Called on capture. Quick flights (under PERFECT_TIME) build the combo, slow ones reset it.
    addPlanet: function (flyTime) {
      var perfect = flyTime < cfg('PERFECT_TIME', 0.75);
      if (perfect) {
        this.combo = Math.min(this.combo + 1, cfg('MAX_COMBO', 5));
        this.streak++;
        if (this.streak > this.perfectStreak) this.perfectStreak = this.streak;
      } else {
        this.combo = 1;
        this.streak = 0;
      }
      this.planets++;
      var points = cfg('PLANET_POINTS', 10) * this.combo;
      this.value += points;
      return { points: points, combo: this.combo, perfect: perfect };
    },

    // Called when a star is collected. Returns the points awarded.
    addStar: function () {
      var points = cfg('STAR_POINTS', 5) * this.combo;
      this.stars++;
      this.value += points;
      return points;
    },

    // Called for slingshots, comet rides, wormhole uses and near misses.
    // Returns the points awarded (base points x combo).
    addBonus: function (kind) {
      var b = BONUS[kind];
      if (!b) return 0;
      var base = b.key ? cfg(b.key, b.fallback) : b.fallback;
      var points = base * this.combo;
      if (b.counter) this[b.counter]++;
      this.value += points;
      return points;
    },

    // Height in "meters": one meter per 10 world px of progress above the start.
    setHeight: function (worldY) {
      this.height = Math.max(this.height, Math.round(-worldY / 10));
    },

    trackSpeed: function (s) {
      if (s > this.maxSpeed) this.maxSpeed = s;
    },

    // Snapshot of the current run, in the Stats shape from SPEC.md.
    stats: function () {
      return {
        score: this.value,
        planets: this.planets,
        stars: this.stars,
        height: this.height,
        slingshots: this.slingshots,
        comets: this.comets,
        wormholes: this.wormholes,
        perfectStreak: this.perfectStreak,
        blackholePasses: this.blackholePasses,
        maxSpeed: this.maxSpeed
      };
    }
  };
})();
