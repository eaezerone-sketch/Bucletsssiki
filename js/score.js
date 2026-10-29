(function () {
  'use strict';
  var ORB = window.ORB = window.ORB || {};

  // Scoring: planets and stars are worth points multiplied by the current combo.
  ORB.Score = {
    value: 0,
    combo: 1,
    planets: 0,
    stars: 0,

    reset: function () {
      this.value = 0;
      this.combo = 1;
      this.planets = 0;
      this.stars = 0;
    },

    // Called on capture. Quick flights (under PERFECT_TIME) build the combo, slow ones reset it.
    addPlanet: function (flyTime) {
      var C = ORB.CONFIG;
      var perfect = flyTime < C.PERFECT_TIME;
      if (perfect) {
        this.combo = Math.min(this.combo + 1, C.MAX_COMBO);
      } else {
        this.combo = 1;
      }
      this.planets++;
      var points = C.PLANET_POINTS * this.combo;
      this.value += points;
      return { points: points, combo: this.combo, perfect: perfect };
    },

    // Called when a star is collected. Returns the points awarded.
    addStar: function () {
      var points = ORB.CONFIG.STAR_POINTS * this.combo;
      this.stars++;
      this.value += points;
      return points;
    }
  };
})();
