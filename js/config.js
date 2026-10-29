(function () {
  'use strict';
  var ORB = window.ORB = window.ORB || {};
  // Tunable constants shared by all modules.
  ORB.CONFIG = {
    // World / view (v1)
    WORLD_W: 420, MIN_VIEW_H: 640, MAX_DPR: 2,
    OFFSCREEN_MARGIN: 40, CAPTURE_PAD: 8, ORBIT_GAP: 26, PLAYER_RADIUS: 7,

    // Launch and flight (v1 LAUNCH_SPEED kept but unused in v2)
    LAUNCH_SPEED: 520, MAX_FLY_TIME: 4.5,

    // Gravity and latching (v2)
    GRAVITY: 7e6,
    LATCH_PAD_MIN: 22, LATCH_PAD_FACTOR: 0.55,
    GRAVITY_RADIUS_FACTOR: 4.4,

    // Tether spring (v2)
    TETHER_K: 55, TETHER_DAMP: 4.5, TETHER_TANGENT: 2.2,

    // Launch boost and speed limits (v2)
    LAUNCH_BOOST: 350, LAUNCH_MIN_SPEED: 520, MAX_SPEED: 950,
    IGNORE_FROM_TIME: 0.35, PHYS_SUBSTEPS: 4,

    // Planet hazards (v2)
    STAR_HEAT_RATE: 0.32, CRUMBLE_TIME: 2.2, BLACKHOLE_KILL_FACTOR: 1.4,

    // Bonus points and comet boost (v2)
    SLINGSHOT_POINTS: 25, COMET_POINTS: 15, WORMHOLE_POINTS: 20, COMET_BOOST: 260,

    // Rising void (v2)
    VOID_START: 560,

    // Camera zoom (v2)
    ZOOM_MIN: 0.82, ZOOM_SPEED_LO: 520, ZOOM_SPEED_HI: 900,

    // Camera follow (v1)
    CAMERA_LERP: 4, CAMERA_LEAD: 0.2,

    // Trail (v2 length)
    TRAIL_LEN: 34,

    // Scoring and combos (v1)
    PERFECT_TIME: 0.75, MAX_COMBO: 5, PLANET_POINTS: 10, STAR_POINTS: 5,

    // Power-ups (v1)
    MAGNET_TIME: 8, MAGNET_RADIUS: 150, SLOW_TIME: 5, SLOW_FACTOR: 0.55,

    // Game over (v1)
    DEATH_DELAY: 1.0,

    // Palette (v1)
    COLORS: {
      bg1: '#05010f', bg2: '#140a33', accent: '#7df9ff', accent2: '#ff5fd2',
      star: '#ffd86b', danger: '#ff5a5a', text: '#eef2ff'
    }
  };
})();
