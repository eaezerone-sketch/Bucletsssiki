(function () {
  'use strict';
  var ORB = window.ORB = window.ORB || {};
  // Tunable constants shared by all modules.
  ORB.CONFIG = {
    WORLD_W: 420, MIN_VIEW_H: 640, MAX_DPR: 2,
    LAUNCH_SPEED: 520, MAX_FLY_TIME: 3.2, OFFSCREEN_MARGIN: 40,
    CAPTURE_PAD: 8, ORBIT_GAP: 26, PLAYER_RADIUS: 7, TRAIL_LEN: 26,
    CAMERA_LERP: 4, CAMERA_LEAD: 0.2,
    PERFECT_TIME: 0.75, MAX_COMBO: 5, PLANET_POINTS: 10, STAR_POINTS: 5,
    MAGNET_TIME: 8, MAGNET_RADIUS: 150, SLOW_TIME: 5, SLOW_FACTOR: 0.55,
    DEATH_DELAY: 1.0,
    COLORS: {
      bg1: '#05010f', bg2: '#140a33', accent: '#7df9ff', accent2: '#ff5fd2',
      star: '#ffd86b', danger: '#ff5a5a', text: '#eef2ff'
    }
  };
})();
