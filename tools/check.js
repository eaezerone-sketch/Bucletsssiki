#!/usr/bin/env node
'use strict';
// Headless check for ORBITA v2. Loads js/*.js in SPEC load order into a vm sandbox,
// verifies the ORB API listed in SPEC.md, then runs DOM-free physics simulations:
//   tether settle, gravity bend, predict() hit, and a 5-run bot.
// Missing files / modules / functions produce clear FAIL lines (never a crash).
// Usage (repo root): node tools/check.js [--seed N] [--quiet]
//   -> exit 0 when everything passes, 1 on any failure. Deterministic for a given seed.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const DT = 1 / 60;
const EPS = 1e-6;
const VIEW_H = 640;      // simulated view height for the void rubber band / ensureAhead
const BOT_RUNS = 5;
const BOT_NEED_PLANETS = 15;
const BOT_NEED_RUNS = 3;
const BOT_MAX_TIME = 600;   // s of simulated time per bot run
const BOT_MAX_PLANETS = 60; // stop a run once this many planets were reached

function argValue(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : def;
}
const SEED = parseInt(argValue('--seed', process.env.CHECK_SEED || '20240607'), 10) || 1;

// Fallback when SPEC.md cannot be parsed (kept equal to the SPEC load order).
const FALLBACK_ORDER = ('js/config.js js/math.js js/storage.js js/i18n.js js/view.js js/input.js js/audio.js ' +
  'js/music.js js/haptics.js js/timefx.js js/camera.js js/difficulty.js js/physics.js js/planets.js js/void.js ' +
  'js/stars.js js/asteroids.js js/powerups.js js/comets.js js/wormholes.js js/player.js js/score.js ' +
  'js/achievements.js js/particles.js js/fx.js js/skins.js js/background.js js/render-orbits.js ' +
  'js/render-special.js js/render-planets.js js/render-entities.js js/render-player.js js/hud.js ' +
  'js/screens.js js/tutorial.js js/game.js').split(' ');

let passes = 0;
const failures = [];

function check(cond, msg) {
  if (cond) { passes++; return true; }
  failures.push(msg);
  console.log('  FAIL: ' + msg);
  return false;
}
function section(title) { console.log('\n== ' + title); }
function info(msg) { console.log('  ' + msg); }
function errText(e) { return e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : String(e); }
function guarded(name, fn) {
  try { return fn(); } catch (e) { check(false, name + ' threw: ' + errText(e)); return undefined; }
}
function f1(n) { return Number(n).toFixed(1); }

// Counts bad conditions inside loops so each one is reported once, with a count.
function Issues() { this.counts = {}; }
Issues.prototype.add = function (key, cond) {
  if (cond) this.counts[key] = (this.counts[key] || 0) + 1;
};
Issues.prototype.report = function (label) {
  const keys = Object.keys(this.counts);
  if (keys.length === 0) return check(true, label);
  keys.forEach(k => check(false, label + ': ' + k + ' (x' + this.counts[k] + ')'));
  return false;
};

// ---- seeded Math.random for the sandbox (reproducible simulations) ----
let rngState = 1;
function reseed(n) { rngState = (n >>> 0) || 1; }
function rng() { // mulberry32
  rngState = (rngState + 0x6D2B79F5) >>> 0;
  let t = rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ---- SPEC / index.html parsing ----
function readLoadOrder() {
  const spec = fs.readFileSync(path.join(ROOT, 'SPEC.md'), 'utf8');
  const at = spec.indexOf('## Load order');
  if (at < 0) throw new Error('SPEC.md has no "## Load order" section');
  const m = /```[^\n]*\n([\s\S]*?)```/.exec(spec.slice(at));
  if (!m) throw new Error('SPEC.md: no code block after "## Load order"');
  const files = m[1].split(/\s+/).filter(s => /\.js$/.test(s));
  if (files.length < 10) throw new Error('SPEC.md load order has only ' + files.length + ' files');
  return files;
}

function checkIndexHtml(files) {
  let html;
  try { html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'); } catch (e) {
    return check(false, 'cannot read index.html: ' + e.message);
  }
  const srcs = [];
  const re = /<script[^>]+src=["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(html))) srcs.push(m[1].replace(/^\.\//, ''));
  const same = srcs.length === files.length && srcs.every((s, i) => s === files[i]);
  if (same) return check(true, 'index.html script tags match the SPEC load order');
  const missing = files.filter(f => srcs.indexOf(f) < 0);
  const extra = srcs.filter(f => files.indexOf(f) < 0);
  if (missing.length) check(false, 'index.html lacks script(s): ' + missing.join(', '));
  if (extra.length) check(false, 'index.html has script(s) not in SPEC: ' + extra.join(', '));
  if (!missing.length && !extra.length) check(false, 'index.html script order differs from the SPEC load order');
  return false;
}

// ---- sandbox (window === global) ----
function makeSandbox() {
  const store = new Map();
  const localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: k => { store.delete(k); },
    clear: () => { store.clear(); }
  };
  const sbMath = Object.create(Math);
  sbMath.random = rng;
  const sandbox = {
    navigator: { language: 'ru', vibrate: function () { return false; } },
    localStorage: localStorage,
    document: {
      readyState: 'loading',
      activeElement: null,
      addEventListener: function () {},
      removeEventListener: function () {},
      getElementById: function () { return null; }
    },
    requestAnimationFrame: function () { return 0; },
    cancelAnimationFrame: function () {},
    addEventListener: function () {},
    removeEventListener: function () {},
    setInterval: function () { return 0; },
    clearInterval: function () {},
    performance: { now: () => Date.now() },
    devicePixelRatio: 1,
    Math: sbMath,
    console: console
  };
  vm.createContext(sandbox);
  sandbox.window = sandbox;
  return sandbox;
}

// ---- API contract from SPEC.md ----
const I18N_KEYS = ['title', 'subtitle', 'play', 'resume', 'restart', 'menu', 'paused', 'gameOver',
  'score', 'best', 'newBest', 'tapHint', 'soundOn', 'soundOff', 'skins', 'locked', 'perfect',
  'shield', 'magnet', 'slow', 'lostTime', 'lostScreen', 'lostAsteroid', 'planets',
  // v2 keys
  'height', 'meters', 'slingshot', 'cometRide', 'warp', 'nearMiss', 'lostVoid', 'lostStar',
  'lostBlackhole', 'achievements', 'achievementUnlocked', 'back', 'stars', 'slingshots', 'comets',
  'wormholes', 'heat', 'crumbling', 'voidNear', 'tutGravity', 'tutVoid', 'tutStar', 'tutBlackhole',
  'tutCrumble', 'latched'];

const CONFIG_KEYS = [
  // v1
  'WORLD_W', 'MIN_VIEW_H', 'MAX_DPR', 'OFFSCREEN_MARGIN', 'ORBIT_GAP', 'PLAYER_RADIUS', 'MAX_FLY_TIME',
  'CAMERA_LERP', 'CAMERA_LEAD', 'PERFECT_TIME', 'MAX_COMBO', 'PLANET_POINTS', 'STAR_POINTS',
  'MAGNET_TIME', 'MAGNET_RADIUS', 'SLOW_TIME', 'SLOW_FACTOR', 'DEATH_DELAY', 'COLORS',
  // v2
  'GRAVITY', 'LATCH_PAD_MIN', 'LATCH_PAD_FACTOR', 'GRAVITY_RADIUS_FACTOR', 'TETHER_K', 'TETHER_DAMP',
  'TETHER_TANGENT', 'LAUNCH_BOOST', 'LAUNCH_MIN_SPEED', 'MAX_SPEED', 'IGNORE_FROM_TIME', 'PHYS_SUBSTEPS',
  'STAR_HEAT_RATE', 'CRUMBLE_TIME', 'BLACKHOLE_KILL_FACTOR', 'SLINGSHOT_POINTS', 'COMET_POINTS',
  'WORMHOLE_POINTS', 'COMET_BOOST', 'VOID_START', 'ZOOM_MIN', 'ZOOM_SPEED_LO', 'ZOOM_SPEED_HI', 'TRAIL_LEN'];

// ORB.Game internals are intentionally not checked beyond the public API.
const EXPECT = [
  ['CONFIG', { values: CONFIG_KEYS }],
  ['M', { fns: ['clamp', 'lerp', 'dist', 'dist2', 'rand', 'randInt', 'pick', 'chance', 'angle', 'wrapAngle',
    'easeOutCubic', 'hsl', 'circleHit'] }],
  ['Storage', { fns: ['get', 'set', 'getBest', 'setBest'] }],
  ['I18N', { fns: ['t'], props: ['lang'] }],
  ['View', { fns: ['init', 'resize', 'onResize', 'worldTransform', 'screenTransform', 'visibleW', 'visibleH'],
    props: ['cssW', 'cssH', 'dpr', 'scale', 'w', 'h'] }],
  ['Input', { fns: ['init', 'onTap', 'onPause'] }],
  ['Audio', { fns: ['unlock', 'play', 'setMuted', 'isMuted', 'toggle', 'getContext'] }],
  ['Music', { fns: ['start', 'stop', 'setIntensity', 'setMuted'] }],
  ['Haptics', { fns: ['buzz', 'setEnabled', 'isEnabled'] }],
  ['TimeFX', { fns: ['reset', 'hitstop', 'slowmo', 'update'], props: ['scale'] }],
  ['Camera', { fns: ['reset', 'update', 'shake', 'getX', 'getY', 'getZoom'],
    props: ['x', 'y', 'zoom', 'shakeT', 'shakeMag'] }],
  ['Difficulty', { fns: ['get'] }],
  ['Physics', { fns: ['gravity', 'stepFree', 'stepTether', 'launchVelocity', 'predict'] }],
  ['Planets', { fns: ['reset', 'ensure', 'update', 'impact', 'startCrumble', 'findLatch', 'blackholeKill',
    'prune', 'highest', 'consume'], props: ['list'] }],
  ['Void', { fns: ['reset', 'update', 'distance', 'draw'], props: ['y'] }],
  ['Stars', { fns: ['reset', 'spawnBetween', 'update', 'prune'], props: ['list'] }],
  ['Asteroids', { fns: ['reset', 'maybeSpawn', 'update', 'nearMiss', 'destroy', 'prune'], props: ['list'] }],
  ['Powerups', { fns: ['reset', 'maybeSpawnBetween', 'update', 'prune'], props: ['list'] }],
  ['Comets', { fns: ['reset', 'maybeSpawn', 'update', 'prune'], props: ['list'] }],
  ['Wormholes', { fns: ['reset', 'maybeSpawnBetween', 'update', 'prune'], props: ['list'] }],
  ['Player', { fns: ['create', 'update', 'launch', 'latch', 'release', 'canLatch', 'tangent'] }],
  ['Score', { fns: ['reset', 'addPlanet', 'addStar', 'addBonus', 'setHeight', 'trackSpeed', 'stats'],
    props: ['value', 'combo', 'planets', 'stars', 'height', 'slingshots', 'comets', 'wormholes',
      'perfectStreak', 'streak', 'blackholePasses', 'maxSpeed'] }],
  ['Achievements', { fns: ['unlocked', 'check', 'name', 'desc', 'count'], props: ['list'] }],
  ['Particles', { fns: ['reset', 'burst', 'ring', 'update', 'draw', 'debris', 'puff'] }],
  ['FX', { fns: ['reset', 'popup', 'shockwave', 'flash', 'setDanger', 'setSpeed', 'update', 'drawWorld',
    'drawScreen'] }],
  ['Skins', { fns: ['isUnlocked', 'currentId', 'current', 'select', 'name'], props: ['list'] }],
  ['Background', { fns: ['init', 'draw'] }],
  ['RenderOrbits', { fns: ['draw'] }],
  ['RenderSpecial', { fns: ['drawStar', 'drawBlackhole'] }],
  ['RenderPlanets', { fns: ['draw'] }],
  ['RenderEntities', { fns: ['draw'] }],
  ['RenderPlayer', { fns: ['draw'] }],
  ['HUD', { fns: ['init', 'show', 'hide', 'setScore', 'setCombo', 'setPowerups', 'flash', 'setHeight',
    'setVoid', 'toast'] }],
  ['Screens', { fns: ['init', 'show', 'hideAll', 'current'] }],
  ['Tutorial', { fns: ['shouldShow', 'show', 'hide', 'done', 'step'] }],
  ['Game', { fns: ['init', 'start', 'pause', 'resume', 'togglePause', 'toMenu', 'getState'] }]
];

function isObj(o) { return !!o && (typeof o === 'object' || typeof o === 'function'); }

function checkApi(ORB) {
  section('API presence (SPEC sections)');
  const missing = [];
  const missingMods = [];
  for (const [mod, spec] of EXPECT) {
    const obj = ORB[mod];
    if (!isObj(obj)) { missingMods.push('ORB.' + mod); continue; }
    (spec.values || []).forEach(k => { if (obj[k] === undefined) missing.push('ORB.' + mod + '.' + k); });
    (spec.fns || []).forEach(f => { if (typeof obj[f] !== 'function') missing.push('ORB.' + mod + '.' + f + '()'); });
    (spec.props || []).forEach(p => { if (!(p in obj)) missing.push('ORB.' + mod + '.' + p); });
  }
  missingMods.forEach(m => check(false, 'module not defined: ' + m));
  missing.forEach(m => check(false, 'missing member ' + m));
  if (!missing.length && !missingMods.length) {
    check(true, 'all ' + EXPECT.length + ' ORB modules and their members present');
  } else {
    info('missing modules: ' + missingMods.length + ', missing members: ' + missing.length);
  }

  if (isObj(ORB.I18N) && typeof ORB.I18N.t === 'function') {
    guarded('I18N keys', () => {
      const iss = new Issues();
      I18N_KEYS.forEach(k => iss.add('no translation for key ' + k, ORB.I18N.t(k) === k));
      iss.report('I18N keys (ru)');
      // The language is detected from navigator.language, so load i18n.js into a second 'en' sandbox.
      const sb = makeSandbox();
      sb.navigator.language = 'en-US';
      vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/i18n.js'), 'utf8'), sb, { filename: 'js/i18n.js' });
      const iss2 = new Issues();
      I18N_KEYS.forEach(k => iss2.add('no EN translation for key ' + k, sb.ORB.I18N.t(k) === k));
      check(sb.ORB.I18N.lang === 'en', 'I18N.lang should be "en" for navigator.language en-US');
      iss2.report('I18N keys (en)');
    });
  }
}

// Returns true when all listed modules/functions exist; otherwise emits one clear FAIL line.
function prereq(label, ORB, spec) {
  const missing = [];
  Object.keys(spec).forEach(mod => {
    if (!isObj(ORB[mod])) { missing.push('ORB.' + mod); return; }
    spec[mod].forEach(f => { if (typeof ORB[mod][f] !== 'function') missing.push('ORB.' + mod + '.' + f + '()'); });
  });
  if (missing.length) {
    check(false, label + ' skipped, needs ' + missing.join(', '));
    return false;
  }
  return true;
}

// ---- helpers for simulations ----
function launchFromPhase(ORB, planet, ang, dir) {
  // Settled ship at orbit angle `ang` around `planet` with tangential speed.
  const R = planet.orbitRadius;
  const nx = Math.cos(ang), ny = Math.sin(ang);
  const sp = planet.angularSpeed * R;
  return {
    x: planet.x + nx * R, y: planet.y + ny * R,
    vx: (planet.vx || 0) - ny * dir * sp, vy: (planet.vy || 0) + nx * dir * sp,
    state: 'orbit', planet: planet, dir: dir, angle: ang, stretch: 0, speed: sp,
    fromPlanet: null, ignorePlanet: null, ignoreT: 0, latchT: 0, flyTime: 0, boostT: 0, trail: []
  };
}

// ---- simple module sanity ----
function runBasics(ORB) {
  const C = ORB.CONFIG, M = ORB.M;

  section('Math / Storage / Skins');
  if (isObj(M) && ['clamp', 'lerp', 'dist', 'dist2', 'wrapAngle', 'circleHit', 'hsl', 'easeOutCubic',
    'randInt', 'rand', 'pick', 'chance'].every(f => typeof M[f] === 'function')) {
    guarded('Math', () => {
      check(M.clamp(5, 0, 3) === 3 && M.clamp(-1, 0, 3) === 0, 'M.clamp');
      check(M.lerp(0, 10, 0.5) === 5, 'M.lerp');
      check(M.dist(0, 0, 3, 4) === 5 && M.dist2(0, 0, 3, 4) === 25, 'M.dist / dist2');
      check(Math.abs(Math.abs(M.wrapAngle(3 * Math.PI)) - Math.PI) < EPS, 'M.wrapAngle');
      check(M.circleHit(0, 0, 5, 6, 0, 2) === true && M.circleHit(0, 0, 5, 8, 0, 2) === false, 'M.circleHit');
      check(/^hsla\(/.test(M.hsl(120, 50, 50)), 'M.hsl should return an hsla(...) string');
      check(M.easeOutCubic(0) === 0 && Math.abs(M.easeOutCubic(1) - 1) < EPS, 'M.easeOutCubic endpoints');
      let rangeOk = true;
      for (let i = 0; i < 2000; i++) {
        const r = M.randInt(1, 3), f = M.rand(2, 5);
        if (!(r >= 1 && r <= 3 && r === Math.floor(r)) || !(f >= 2 && f <= 5)) rangeOk = false;
      }
      check(rangeOk, 'M.rand / M.randInt out of range');
      check(M.pick([7]) === 7 && typeof M.chance(0.5) === 'boolean', 'M.pick / M.chance');
    });
  } else check(false, 'Math helpers skipped, ORB.M incomplete');

  if (prereq('Storage test', ORB, { Storage: ['get', 'set', 'getBest', 'setBest'] })) {
    guarded('Storage', () => {
      ORB.Storage.set('check.tmp', { a: 1 });
      check(ORB.Storage.get('check.tmp', null).a === 1, 'Storage set/get roundtrip');
      check(ORB.Storage.get('check.missing', 'def') === 'def', 'Storage.get default on missing key');
      ORB.Storage.setBest(42);
      check(ORB.Storage.getBest() === 42, 'Storage.getBest/setBest');
    });
  }
  if (isObj(ORB.Skins) && ORB.Skins.list && typeof ORB.Skins.current === 'function') {
    guarded('Skins', () => {
      check(ORB.Skins.list.length === 6, 'Skins.list should have 6 skins');
      check(ORB.Skins.current() && typeof ORB.Skins.current().color === 'string', 'Skins.current() has no color');
      check(ORB.Skins.isUnlocked(ORB.Skins.list[0], 0) === true, 'first skin should be unlocked at 0 points');
    });
  } else check(false, 'Skins test skipped, ORB.Skins incomplete');

  section('Difficulty (v2 curves)');
  if (prereq('Difficulty test', ORB, { Difficulty: ['get'] })) {
    guarded('Difficulty', () => {
      const D = ORB.Difficulty;
      const d0 = D.get(0), d5 = D.get(5), d10 = D.get(10), d50 = D.get(50), d60 = D.get(60), d70 = D.get(70);
      const w0 = d0.typeWeights || {};
      check(w0.rocky === 5 && w0.gas === 1 && !w0.ice && !w0.lava && !w0.jelly && !w0.star && !w0.crumble,
        'Difficulty.get(0).typeWeights should be {rocky:5, gas:1, rest 0}, got ' + JSON.stringify(w0));
      const wl = D.get(40).typeWeights || {};
      check(wl.ice > 1.5 && wl.jelly > 1.5 && wl.lava > 1.5 && wl.star > 1 && wl.crumble > 1 && wl.rocky < 4,
        'Difficulty.get(40).typeWeights should approach {rocky:3, ice:2, gas:2, lava:2, jelly:2, star:1.5, crumble:1.5}, got ' +
        JSON.stringify(wl));
      check(D.get(2).typeWeights.ice === 0 && D.get(3).typeWeights.jelly === 0 && D.get(5).typeWeights.star === 0 &&
        D.get(7).typeWeights.crumble === 0, 'type weights must stay 0 before their unlock points (ice 3, jelly 4, star 6, crumble 8)');
      check(d10.blackholeChance === 0 && d50.blackholeChance > 0.2 && d50.blackholeChance <= 0.3,
        'blackholeChance should be 0 until 10 and ~0.28 by 50 (got ' + d10.blackholeChance + ' / ' + d50.blackholeChance + ')');
      check(d5.cometRate === 0 && D.get(10).cometRate > 0 && D.get(60).cometRate <= 0.21,
        'cometRate should be 0 until 5 then 0.06..0.2');
      check(D.get(5).wormholeChance === 0 && D.get(12).wormholeChance > 0 && D.get(60).wormholeChance <= 0.17,
        'wormholeChance should be 0 until 6 then 0.1..0.16');
      check(Math.abs(d0.voidSpeed - 16) < 0.5 && Math.abs(d70.voidSpeed - 78) < 1,
        'voidSpeed should go 16 -> 78 over 70 planets (got ' + d0.voidSpeed + ' -> ' + d70.voidSpeed + ')');
      check(d0.asteroidRate === 0 && d0.moveChance === 0, 'Difficulty.get(0): no asteroids or moving planets expected');
      check(d60.angularSpeed >= d0.angularSpeed && d60.asteroidRate > 0 && d60.moveChance > 0,
        'Difficulty should ramp up with planets');
      check(d60.angularSpeed <= 3.2 + EPS && d60.gapMax <= 300 + EPS, 'Difficulty.get(60) above ceiling');
      check(d0.gapMax <= 240 && d0.angularSpeed <= 1.8, 'first planets should be easy (small gaps, slow spin)');
    });
  }

  section('Planets: reset / ensure / types / blackholes');
  if (prereq('Planets test', ORB, { Planets: ['reset', 'ensure', 'highest', 'update'], Difficulty: ['get'] })) {
    guarded('Planets', () => {
      reseed(SEED + 11);
      const P = ORB.Planets, d0 = ORB.Difficulty.get(0);
      P.reset();
      const first = P.list[0];
      check(P.list.length === 1 && first.x === C.WORLD_W / 2 && first.y === 0 && first.radius === 30 &&
        first.type === 'rocky' && first.visited === true && !(first.moveAmp > 0) && first.angularSpeed === 1.7 &&
        first.moons.length >= 1, 'Planets.reset(): expected one static visited rocky planet r30 at (WORLD_W/2, 0), angularSpeed 1.7, a moon');
      const made = P.ensure(-3000, d0);
      const list = P.list;
      check(Array.isArray(made) && made.length === list.length - 1,
        'Planets.ensure() must return exactly the newly created planets');
      check(list.length > 5, 'Planets.ensure(-3000) created only ' + (list.length - 1) + ' planets');
      check(P.highest().y <= -3000, 'ensure(-3000) must stop once the highest planet is above -3000');
      check(P.ensure(-3000, d0).length === 0, 'second ensure() with the same topY must create nothing');

      const iss = new Issues();
      const chain = list.filter(p => p.type !== 'blackhole');
      check(P.highest() === chain[chain.length - 1], 'Planets.highest() must be the last non-blackhole planet');
      for (let i = 1; i < chain.length; i++) {
        const a = chain[i - 1], b = chain[i];
        const gap = a.y - b.y;
        iss.add('vertical gap outside [gapMin,gapMax]', gap < d0.gapMin - EPS || gap > d0.gapMax + EPS);
        iss.add('orbitRadius != radius + ORBIT_GAP', Math.abs(b.orbitRadius - (b.radius + C.ORBIT_GAP)) > EPS);
        iss.add('latchRadius != orbit + max(PAD_MIN, orbit*FACTOR)',
          Math.abs(b.latchRadius - (b.orbitRadius + Math.max(C.LATCH_PAD_MIN, b.orbitRadius * C.LATCH_PAD_FACTOR))) > 1e-3);
        iss.add('gravityRadius != orbitRadius*GRAVITY_RADIUS_FACTOR',
          Math.abs(b.gravityRadius - b.orbitRadius * C.GRAVITY_RADIUS_FACTOR) > 1e-3);
        iss.add('x outside world', b.baseX - b.orbitRadius < 0 || b.baseX + b.orbitRadius > C.WORLD_W);
        iss.add('latch zones closer than prev.latchRadius+latchRadius+20',
          Math.hypot(b.baseX - a.baseX, b.y - a.y) < a.latchRadius + b.latchRadius + 20 - 1e-3);
        iss.add('horizontal offset to previous < 40', Math.abs(b.baseX - a.baseX) < 40 - 1e-3);
        iss.add('ids not increasing', b.id <= a.id);
        iss.add('star/crumble twice in a row', (b.type === 'star' || b.type === 'crumble') && b.type === a.type);
        iss.add('unknown planet type ' + b.type, ['rocky', 'ice', 'gas', 'lava', 'jelly', 'star', 'crumble'].indexOf(b.type) < 0);
        iss.add('angularSpeed not positive/finite', !(b.angularSpeed > 0) || !isFinite(b.angularSpeed));
        iss.add('missing field (visited/moons/crumble/dead/heat/seed/mass)',
          b.visited !== false || !Array.isArray(b.moons) || b.crumble !== -1 || b.dead !== false || b.heat !== 0 ||
          typeof b.seed !== 'number' || !(b.mass > 0));
      }
      for (let i = 1; i < list.length; i++) iss.add('list not in y order (rising)', list[i].y > list[i - 1].y + EPS);
      iss.report('Planets chain spacing/fields (difficulty 0)');

      // Rich world: all types, blackholes, movers.
      P.reset();
      for (let n = 0; n < 6; n++) P.ensure(-6000 * (n + 1), ORB.Difficulty.get(8 * n + 4));
      P.ensure(-60000, ORB.Difficulty.get(50));
      const rich = P.list;
      const types = {};
      rich.forEach(p => { types[p.type] = (types[p.type] || 0) + 1; });
      info('type counts: ' + JSON.stringify(types));
      ['rocky', 'ice', 'gas', 'lava', 'jelly', 'star', 'crumble', 'blackhole'].forEach(t =>
        check(types[t] > 0, 'no "' + t + '" planet generated in a long mixed-difficulty ensure'));
      const bi = new Issues();
      const rchain = rich.filter(p => p.type !== 'blackhole');
      let lastBh = -99;
      rich.forEach((b, idx) => {
        if (b.type !== 'blackhole') return;
        bi.add('blackhole radius outside 14..18', b.radius < 14 - EPS || b.radius > 18 + EPS);
        bi.add('blackhole gravityRadius != 230', b.gravityRadius !== 230);
        bi.add('blackhole mass != 3.2', Math.abs(b.mass - 3.2) > EPS);
        bi.add('blackhole must not be latchable (latchRadius > 0)', b.latchRadius > 0);
        bi.add('blackhole x outside 50..WORLD_W-50', b.x < 50 - EPS || b.x > C.WORLD_W - 50 + EPS);
        const ci = rchain.findIndex(q => q.y < b.y); // first chain planet above
        const below = ci > 0 ? rchain[ci - 1] : null, above = ci >= 0 ? rchain[ci] : null;
        bi.add('blackhole not between two chain planets in y', !below || !above);
        if (below && above) {
          bi.add('blackhole < 90 px horizontally from a chain neighbour',
            Math.abs(b.x - below.baseX) < 90 - 1e-3 || Math.abs(b.x - above.baseX) < 90 - 1e-3);
        }
        const chainIdx = rchain.indexOf(below);
        bi.add('two blackholes within 3 chain planets', chainIdx - lastBh < 3 && lastBh > -99);
        lastBh = chainIdx;
        void idx;
      });
      bi.report('Blackhole placement rules');
      check(P.findLatch(rich[0].x, rich[0].y, null) !== undefined, 'Planets.findLatch must return a planet or null');
      const bh = rich.find(p => p.type === 'blackhole');
      if (bh) {
        check(P.blackholeKill(bh.x, bh.y) === bh, 'Planets.blackholeKill at a blackhole centre must return it');
        check(P.findLatch(bh.x, bh.y, null) !== bh, 'Planets.findLatch must skip blackholes');
        check(P.blackholeKill(bh.x + bh.radius * C.BLACKHOLE_KILL_FACTOR + 3, bh.y) !== bh,
          'blackholeKill outside the kill radius must not return the blackhole');
      }

      // Movers stay inside the world and keep a finite velocity.
      const mv = rich.filter(p => p.moveAmp > 0);
      check(mv.length > 0, 'high difficulty: expected some moving planets');
      for (let s = 0; s < 600; s++) P.update(DT);
      const mi = new Issues();
      mv.forEach(m => {
        mi.add('moving planet baseX +- moveAmp leaves the world', m.baseX - m.moveAmp < -EPS || m.baseX + m.moveAmp > C.WORLD_W + EPS);
        mi.add('moving planet x/vx not finite', !isFinite(m.x) || !isFinite(m.vx));
      });
      mi.report('Moving planets');

      // Lifecycle: crumble, consume, prune.
      P.reset();
      P.ensure(-800, d0);
      const cr = P.list[1];
      P.startCrumble(cr);
      check(cr.crumble === 0, 'startCrumble should set crumble to 0');
      const steps = Math.ceil((C.CRUMBLE_TIME + 0.2) / DT);
      for (let s = 0; s < steps; s++) P.update(DT);
      check(cr.dead === true, 'a crumbling planet must be dead after CRUMBLE_TIME');
      check(P.findLatch(cr.x, cr.y, null) !== cr, 'findLatch must skip dead planets');
      const eaten = P.consume(P.list[0].y - P.list[0].radius - 1); // void surface just above the start planet
      check(P.list[0].dead === true && eaten.indexOf(P.list[0]) >= 0, 'consume(voidY) must mark planets below the void as dead');
      P.update(1.2);
      P.prune(1e9);
      check(P.list.indexOf(cr) < 0, 'prune should remove dead planets older than 1 s');
    });
  }

  section('Void / Score');
  if (prereq('Void test', ORB, { Void: ['reset', 'update', 'distance'] })) {
    guarded('Void', () => {
      const V = ORB.Void;
      V.reset(560);
      check(V.y === 560, 'Void.reset(y) must set y');
      const diff = { voidSpeed: 30 };
      const y0 = V.y;
      V.update(1, 400, 640, diff); // distance 160, no rubber band
      check(Math.abs((y0 - V.y) - 30) < 0.5, 'Void should rise voidSpeed px/s (rose ' + f1(y0 - V.y) + ')');
      V.reset(560);
      V.update(1, -2000, 640, diff); // far above the void: rubber band 3x
      check(Math.abs((560 - V.y) - 90) < 0.5, 'Void should rise 3x faster when far below the player (rose ' + f1(560 - V.y) + ')');
      const yb = V.y;
      V.update(1, 5000, 640, diff);
      check(V.y <= yb, 'Void must never move down');
      check(Math.abs(V.distance(100) - (V.y - 100)) < EPS, 'Void.distance(y) must be this.y - y');
    });
  }
  if (prereq('Score test', ORB, { Score: ['reset', 'addPlanet', 'addStar', 'addBonus', 'setHeight', 'trackSpeed', 'stats'] })) {
    guarded('Score', () => {
      const S = ORB.Score;
      S.reset();
      const a = S.addPlanet(0.3);
      check(a.perfect === true && a.combo === 2 && a.points === C.PLANET_POINTS * 2, 'Score.addPlanet(0.3) should be perfect with combo 2');
      const b = S.addPlanet(2.0);
      check(b.perfect === false && b.combo === 1 && b.points === C.PLANET_POINTS, 'Score.addPlanet(2.0) should reset combo to 1');
      const s = S.addStar();
      check(s === C.STAR_POINTS * S.combo, 'Score.addStar points = STAR_POINTS * combo');
      check(S.planets === 2 && S.stars === 1 && S.value === a.points + b.points + s, 'Score totals inconsistent');
      S.reset();
      for (let i = 0; i < 10; i++) S.addPlanet(0.1);
      check(S.combo === C.MAX_COMBO && S.perfectStreak === 10, 'combo should cap at MAX_COMBO and perfectStreak track the streak');
      S.reset();
      S.combo = 2;
      check(S.addBonus('slingshot') === C.SLINGSHOT_POINTS * 2 && S.slingshots === 1, 'addBonus(slingshot) = SLINGSHOT_POINTS*combo');
      check(S.addBonus('comet') === C.COMET_POINTS * 2 && S.comets === 1, 'addBonus(comet)');
      check(S.addBonus('wormhole') === C.WORMHOLE_POINTS * 2 && S.wormholes === 1, 'addBonus(wormhole)');
      check(S.addBonus('nearMiss') === 20, 'addBonus(nearMiss) = 10*combo');
      S.setHeight(-1234);
      S.setHeight(-500);
      check(S.height === 123, 'setHeight keeps the max, round(-y/10) (got ' + S.height + ')');
      S.trackSpeed(700); S.trackSpeed(300);
      const st = S.stats();
      check(st.maxSpeed === 700 && st.height === 123 && st.slingshots === 1 && typeof st.score === 'number' &&
        'perfectStreak' in st && 'blackholePasses' in st, 'Score.stats() shape/values');
    });
  }
}

// ---- 1. tether settle ----
function runTetherTests(ORB) {
  section('Tether: latched ship with outward velocity settles on orbitRadius');
  if (!prereq('Tether test', ORB, { Planets: ['reset', 'update', 'ensure'], Player: ['create', 'latch', 'update'],
    Physics: ['stepTether'], Difficulty: ['get'] })) return;
  const P = ORB.Planets, Pl = ORB.Player;

  // Latch at the edge of the latch zone, moving outward + tangentially, then simulate `secs`.
  function trial(label, planet, ang, radial, tang, tol, secs, moving) {
    const nx = Math.cos(ang), ny = Math.sin(ang);
    const d0 = planet.latchRadius * 0.97;
    const p = Pl.create(planet);
    p.x = planet.x + nx * d0; p.y = planet.y + ny * d0;
    p.vx = (planet.vx || 0) + nx * radial - ny * tang;
    p.vy = (planet.vy || 0) + ny * radial + nx * tang;
    Pl.latch(p, planet);
    const R = planet.orbitRadius;
    let maxD = 0, minD = 1e9, bad = false, t = 0;
    const steps = Math.round(secs / DT);
    for (let i = 0; i < steps; i++) {
      if (moving) P.update(DT);
      Pl.update(p, DT);
      t += DT;
      const d = Math.hypot(p.x - planet.x, p.y - planet.y);
      if (!isFinite(d) || !isFinite(p.vx)) { bad = true; break; }
      if (d > maxD) maxD = d;
      if (d < minD) minD = d;
    }
    const d = Math.hypot(p.x - planet.x, p.y - planet.y);
    const vt = Math.hypot(p.vx - (planet.vx || 0), p.vy - (planet.vy || 0));
    const vT = planet.angularSpeed * R;
    check(!bad, label + ': non-finite position/velocity during simulation');
    check(Math.abs(d - R) < tol,
      label + ': after ' + secs + ' s distance ' + f1(d) + ' should be within ' + tol + ' px of orbitRadius ' + f1(R));
    check(Math.abs(vt - vT) < 0.15 * vT + 4,
      label + ': orbit speed ' + f1(vt) + ' should ease to angularSpeed*R = ' + f1(vT));
    check(p.state === 'orbit' && p.planet === planet, label + ': ship must stay latched (state ' + p.state + ')');
    check(isFinite(p.stretch) && Math.abs(p.stretch - (d - R) / R) < 0.05, label + ': p.stretch should track (d-R)/R');
    info(label + ': d ' + f1(d) + '/' + f1(R) + ' (range ' + f1(minD) + '..' + f1(maxD) + '), speed ' + f1(vt) + '/' + f1(vT));
  }

  guarded('tether', () => {
    reseed(SEED + 21);
    P.reset();
    const d0 = ORB.Difficulty.get(0);
    P.ensure(-1500, d0);
    const planet = P.list[0];
    trial('rocky, outward 300 + tangent 200', planet, -0.7, 300, 200, 3, 3, false);
    trial('rocky, outward 120 + tangent 450', planet, 2.2, 120, 450, 3, 3, false);
    trial('rocky, pure outward 400', planet, 0.4, 400, 0, 3, 3, false);
    // Counter-clockwise: dir must be derived from the velocity.
    trial('rocky, tangent against dir (ccw)', planet, 1.0, 200, -300, 3, 3, false);

    const jelly = P.list[1];
    const savedK = jelly.tetherK;
    jelly.tetherK = 0.5;
    trial('jelly (tetherK 0.5)', jelly, -1.2, 300, 200, 3, 3, false);
    jelly.tetherK = savedK;

    // A moving planet (relative-frame physics): use a high-difficulty mover.
    P.reset();
    P.ensure(-8000, ORB.Difficulty.get(40));
    const mover = P.list.find(q => q.moveAmp > 0 && q.type !== 'blackhole');
    if (mover) trial('moving planet (amp ' + f1(mover.moveAmp) + ')', mover, -0.5, 300, 200, 3.5, 3, true);
    else check(false, 'tether moving-planet case skipped: no moving planet generated at difficulty 40');

    // The settled ship keeps orbiting indefinitely around a static planet.
    P.reset();
    const home = P.list[0];
    const p = Pl.create(home);
    let drift = 0;
    for (let i = 0; i < 600; i++) { Pl.update(p, DT); drift = Math.max(drift, Math.abs(Math.hypot(p.x - home.x, p.y - home.y) - home.orbitRadius)); }
    check(drift < 0.5, 'a freshly created ship should stay on orbitRadius (max drift ' + drift.toFixed(3) + ' px)');
  });
}

// ---- 2. gravity bends flight ----
function runGravityTests(ORB) {
  section('Gravity: planets bend a free flight');
  if (!prereq('Gravity test', ORB, { Planets: ['reset'], Physics: ['gravity', 'stepFree'] })) return;
  const C = ORB.CONFIG, Ph = ORB.Physics;

  guarded('gravity', () => {
    ORB.Planets.reset();
    const pl = ORB.Planets.list[0];
    const R = pl.orbitRadius;
    const gr = pl.gravityRadius;

    // Field direction / range / ignore / strongest.
    const g = Ph.gravity(pl.x + 100, pl.y, [pl], null);
    check(g.ax < 0 && Math.abs(g.ay) < 1e-6 && g.strongest === pl && g.strength > 0,
      'gravity() 100 px right of a planet must pull left (ax ' + f1(g.ax) + ') and report the planet as strongest');
    const gUp = Ph.gravity(pl.x, pl.y - 100, [pl], null);
    check(gUp.ay > 0, 'gravity() above a planet must pull down (y down)');
    const gOut = Ph.gravity(pl.x + gr + 5, pl.y, [pl], null);
    check(gOut.ax === 0 && gOut.ay === 0 && gOut.strongest === null, 'gravity() outside gravityRadius must be zero, strongest null');
    const gIgn = Ph.gravity(pl.x + 100, pl.y, [pl], pl);
    check(gIgn.ax === 0 && gIgn.strongest === null, 'gravity() must skip the ignored planet');
    const near = Ph.gravity(pl.x + pl.radius * 1.3 + 1, pl.y, [pl], null).strength;
    const nearer = Ph.gravity(pl.x + pl.radius + 2, pl.y, [pl], null).strength;
    check(near > 0 && nearer > 0 && nearer <= near * 1.5, 'gravity softening: strength must not blow up inside radius*1.3');
    const gBefore = Ph.gravity(pl.x + 100, pl.y, [pl], null).strength;
    const dead = { x: pl.x, y: pl.y, radius: pl.radius, gravityRadius: gr, mass: 1, dead: true };
    check(Ph.gravity(pl.x + 100, pl.y, [dead], null).strength === 0, 'gravity() must skip dead planets');
    check(gBefore > 0, 'gravity at 100 px must be positive');

    // Straight flight past the planet: x-offset 100 (outside the latch zone, inside gravityRadius).
    const off = Math.max(pl.latchRadius + 14, 100);
    function fly(planets) {
      const p = { x: pl.x + off, y: pl.y + 320, vx: 0, vy: -520, speed: 520 };
      let minD = 1e9;
      for (let i = 0; i < 240 && p.y > pl.y - 320; i++) {
        Ph.stepFree(p, DT, planets, null);
        minD = Math.min(minD, Math.hypot(p.x - pl.x, p.y - pl.y));
      }
      return { p: p, minD: minD };
    }
    check(off < gr, 'test geometry: offset ' + f1(off) + ' must be inside gravityRadius ' + f1(gr));
    const ctrl = fly([]);
    const withG = fly([pl]);
    check(Math.abs(ctrl.p.vx) < 1e-9, 'control flight without planets must stay straight');
    const bend = Math.atan2(withG.p.vx, -withG.p.vy) * 180 / Math.PI; // deg from "straight up", negative = toward planet
    check(withG.p.vx < -5, 'flight past a planet must bend toward it (final vx ' + f1(withG.p.vx) + ')');
    check(Math.abs(bend) > 3, 'gravity bend should exceed 3 degrees (got ' + f1(bend) + ')');
    check(withG.minD < ctrl.minD - 1, 'bent path must pass closer to the planet than the straight path');
    check(isFinite(withG.p.speed) && Math.abs(withG.p.speed - Math.hypot(withG.p.vx, withG.p.vy)) < 1e-6,
      'stepFree must update p.speed');
    info('bend ' + f1(bend) + ' deg, vx ' + f1(withG.p.vx) + ', closest ' + f1(withG.minD) + ' vs ' + f1(ctrl.minD) + ' straight (R=' + f1(R) + ')');

    // Heavier planet bends more than lighter one.
    const heavy = Object.assign({}, pl, { mass: pl.mass * 2 });
    const bendHeavy = (function () {
      const p = { x: pl.x + off, y: pl.y + 320, vx: 0, vy: -520, speed: 520 };
      for (let i = 0; i < 240 && p.y > pl.y - 320; i++) Ph.stepFree(p, DT, [heavy], null);
      return p.vx;
    })();
    check(bendHeavy < withG.p.vx, 'a planet with double mass must bend the flight more');

    // Frame-rate independence (roughly): 30 fps vs 120 fps final heading.
    function flyDt(dt) {
      const p = { x: pl.x + off, y: pl.y + 320, vx: 0, vy: -520, speed: 520 };
      for (let i = 0; i < 2000 && p.y > pl.y - 320; i++) Ph.stepFree(p, dt, [pl], null);
      return p.vx;
    }
    const v30 = flyDt(1 / 30), v120 = flyDt(1 / 120);
    check(Math.abs(v30 - v120) < 0.15 * Math.abs(v120) + 3, 'free flight should be nearly frame-rate independent (vx ' + f1(v30) + ' @30fps vs ' + f1(v120) + ' @120fps)');

    // Speed cap.
    const fast = { x: 0, y: 0, vx: 3000, vy: -2000, speed: 0 };
    Ph.stepFree(fast, DT, [], null);
    check(fast.speed <= C.MAX_SPEED + 1e-6, 'stepFree must clamp speed to MAX_SPEED (got ' + f1(fast.speed) + ')');

    // Ignored planet exerts no pull.
    const q = { x: pl.x + off, y: pl.y, vx: 0, vy: -500, speed: 500 };
    for (let i = 0; i < 30; i++) Ph.stepFree(q, DT, [pl], pl);
    check(q.vx === 0, 'stepFree must not apply gravity from the ignore planet');
  });
}

// ---- 3. predict ----
function runPredictTests(ORB) {
  section('predict(): trajectory preview finds latchable planets');
  if (!prereq('predict test', ORB, { Planets: ['reset', 'ensure', 'findLatch'], Physics: ['predict', 'launchVelocity', 'stepFree'],
    Difficulty: ['get'] })) return;
  const C = ORB.CONFIG, P = ORB.Planets, Ph = ORB.Physics;

  guarded('predict', () => {
    reseed(SEED + 31);
    P.reset();
    P.ensure(-1500, ORB.Difficulty.get(0));
    const home = P.list[0];
    const list = P.list;

    // Sweep orbit phases; a launch aimed at a higher planet must exist and be reported as hit.
    let aimed = 0, agree = 0, disagree = 0, noPoints = 0;
    const hitIds = {};
    const firstAim = [];
    for (let deg = 0; deg < 360; deg += 2) {
      const p = launchFromPhase(ORB, home, deg * Math.PI / 180, 1);
      const v = Ph.launchVelocity(p);
      const r = Ph.predict(p.x, p.y, v.vx, v.vy, list, home, 1.3, 1 / 30);
      if (!r.points || r.points.length < 2) { noPoints++; continue; }
      if (r.hit) {
        aimed++;
        hitIds[r.hit.id] = true;
        if (r.hit === home) { check(false, 'predict hit the ignored launch planet'); continue; }
        // Reality check: the same launch under stepFree/findLatch should latch the same planet.
        const q = { x: p.x, y: p.y, vx: v.vx, vy: v.vy, speed: 0 };
        let got = null, t = 0;
        while (t < 1.6 && !got) {
          Ph.stepFree(q, DT, list, null);
          t += DT;
          got = P.findLatch(q.x, q.y, t < C.IGNORE_FROM_TIME ? home : null);
        }
        if (got === r.hit) agree++; else disagree++;
        if (firstAim.length < 1) firstAim.push({ deg: deg, hit: r.hit, v: v });
      }
    }
    check(noPoints === 0, 'predict() must return >= 2 points for every call (' + noPoints + ' empty)');
    check(aimed > 0, 'predict(): no launch phase out of 180 produced a hit on any planet');
    check(aimed === 0 || agree >= 0.8 * (agree + disagree),
      'predict() hit must match the real flight (agree ' + agree + ', disagree ' + disagree + ')');
    info('phases with a predicted hit: ' + aimed + '/180, distinct targets: ' + Object.keys(hitIds).length +
      ', matching real flight: ' + agree + '/' + (agree + disagree));

    // Result object / pooling.
    const p0 = launchFromPhase(ORB, home, 1.0, 1);
    const v0 = Ph.launchVelocity(p0);
    const r1 = Ph.predict(p0.x, p0.y, v0.vx, v0.vy, list, home);
    const pts1 = r1.points;
    const first1 = pts1[0];
    const r2 = Ph.predict(p0.x, p0.y, v0.vx, v0.vy, list, home);
    check(r1 === r2 && r2.points === pts1 && r2.points[0] === first1, 'predict() must reuse one result object, points array and point objects');
    check(Math.abs(r2.points[0].x - p0.x) < 1e-9 && Math.abs(r2.points[0].y - p0.y) < 1e-9, 'predict() first point must be the start position');
    // Default maxTime ~1.3 s: ~1.3*30 + 1 points when nothing is hit.
    const farOut = Ph.predict(-5000, -5000, 100, -100, [], null);
    check(farOut.hit === null && farOut.points.length >= 38 && farOut.points.length <= 42,
      'predict() default maxTime 1.3 / step 1/30 should give ~40 points (got ' + farOut.points.length + ')');
    const shortRun = Ph.predict(-5000, -5000, 100, -100, [], null, 0.5, 1 / 30);
    check(shortRun.points.length >= 15 && shortRun.points.length <= 18, 'predict(maxTime 0.5) should give ~16 points (got ' + shortRun.points.length + ')');
    check(Math.abs(shortRun.points[shortRun.points.length - 1].x - (-5000 + 100 * 0.5)) < 2, 'predict() free-space endpoint should match v*t');

    // Ignore rule: from the planet's own orbit position the first points must not "hit" the ignored planet.
    const out = Ph.predict(home.x, home.y + home.orbitRadius, 0, 0.01, [home], home, 0.1, 1 / 30);
    check(out.hit === null, 'predict() must not report the ignored launch planet as a hit during IGNORE_FROM_TIME');

    // Straight shot at a planet reports the planet.
    const target = list[1];
    const sx = target.x, sy = target.y + target.latchRadius + 200;
    const direct = Ph.predict(sx, sy, 0, -600, [target], null, 1.3, 1 / 30);
    check(direct.hit === target, 'predict() must return the planet when flying straight at it');
    check(Math.hypot(direct.points[direct.points.length - 1].x - target.x, direct.points[direct.points.length - 1].y - target.y) <= target.latchRadius + 15,
      'predict() must end at the latch radius of the hit planet');

    // Dead planets are not hit.
    const deadT = Object.assign({}, target, { dead: true });
    check(Ph.predict(sx, sy, 0, -600, [deadT], null, 1.3, 1 / 30).hit === null, 'predict() must skip dead planets');

    // Black hole: stops at the kill radius, no hit.
    const bh = { type: 'blackhole', x: 210, y: 0, radius: 16, orbitRadius: 16, latchRadius: 0, gravityRadius: 230,
      mass: 3.2, tetherK: 0, dead: false };
    const kr = bh.radius * C.BLACKHOLE_KILL_FACTOR;
    const rb = Ph.predict(210, 300, 0, -500, [bh], null, 1.3, 1 / 30);
    const last = rb.points[rb.points.length - 1];
    check(rb.hit === null, 'predict() into a black hole must not report a hit planet');
    check(Math.hypot(last.x - bh.x, last.y - bh.y) < kr + 12 && rb.points.length < 35,
      'predict() must stop on a black hole kill radius (last point ' + f1(Math.hypot(last.x - bh.x, last.y - bh.y)) + ' px away, ' + rb.points.length + ' points)');
  });
}

// ---- 4. the bot ----
function runBot(ORB, runIdx) {
  const C = ORB.CONFIG, P = ORB.Planets, Pl = ORB.Player, Ph = ORB.Physics, V = ORB.Void;
  reseed(SEED + 1000 + runIdx * 7919);
  P.reset();
  const first = P.list[0];
  V.reset(first.y + C.VOID_START);
  if (ORB.Score && ORB.Score.reset) ORB.Score.reset();
  const p = Pl.create(first);
  const res = { reached: 0, cause: null, time: 0, launches: 0, bhPasses: 0, maxSpeed: 0,
    types: {}, bestHeight: 0, orbitWait: 0 };
  let flightBh = null;
  let orbitT = 0;
  let frame = 0;
  const maxFrames = Math.round(BOT_MAX_TIME / DT);

  function die(cause) { res.cause = cause; }

  while (!res.cause && frame < maxFrames) {
    frame++;
    const diff = ORB.Difficulty.get(res.reached);
    P.ensure(p.y - VIEW_H * 1.2, diff);
    P.update(DT);
    Pl.update(p, DT);
    res.time += DT;
    if (!isFinite(p.x) || !isFinite(p.y) || !isFinite(p.vx) || !isFinite(p.vy)) { die('NaN'); break; }
    if (p.speed > res.maxSpeed) res.maxSpeed = p.speed;
    if (-p.y > res.bestHeight) res.bestHeight = -p.y;

    // Stars cool down when not orbited.
    for (let i = 0; i < P.list.length; i++) {
      const q = P.list[i];
      if (q.type === 'star' && q.heat > 0 && !(p.state === 'orbit' && p.planet === q)) q.heat = Math.max(0, q.heat - 0.5 * DT);
    }

    if (p.state === 'orbit') {
      const pl = p.planet;
      orbitT += DT;
      if (pl.type === 'star') {
        pl.heat += C.STAR_HEAT_RATE * DT;
        if (pl.heat >= 1) { die('lostStar'); break; }
      }
      if (pl.dead) {
        if (pl.crumble >= 1) { Pl.release(p); orbitT = 0; flightBh = null; } else { die('lostVoid'); break; }
      } else if (frame % 2 === 0) {
        // Bot: launch when the predicted path latches a higher, unvisited planet.
        const urgent = (pl.type === 'star' && pl.heat > 0.75) || pl.crumble > 0.6 || V.y - p.y < 160;
        const v = Ph.launchVelocity(p);
        const r = Ph.predict(p.x, p.y, v.vx, v.vy, P.list, pl, 1.3, 1 / 30);
        const h = r.hit;
        if (h && h !== pl && h.y < pl.y - 10 && (!h.visited || urgent)) {
          Pl.launch(p);
          res.launches++;
          res.orbitWait += orbitT;
          orbitT = 0;
          flightBh = null;
        }
      }
    } else if (p.state === 'fly') {
      const ign = p.ignoreT > 0 ? p.ignorePlanet : null;
      const kill = P.blackholeKill(p.x, p.y);
      if (kill) { die('lostBlackhole'); break; }
      const hit = P.findLatch(p.x, p.y, ign);
      if (hit) {
        const s = Pl.latch(p, hit);
        P.impact(hit, s, Math.atan2(p.y - hit.y, p.x - hit.x));
        orbitT = 0;
        if (!hit.visited) {
          hit.visited = true;
          res.reached++;
          res.types[hit.type] = (res.types[hit.type] || 0) + 1;
          if (ORB.Score && ORB.Score.addPlanet) ORB.Score.addPlanet(p.flyTime);
        }
        if (hit.type === 'crumble') P.startCrumble(hit);
      } else {
        // Black hole pass bonus bookkeeping (within 2.4 x radius, once per hole per flight).
        for (let i = 0; i < P.list.length; i++) {
          const q = P.list[i];
          if (q.type !== 'blackhole' || q.dead || q === flightBh) continue;
          const dd = Math.hypot(p.x - q.x, p.y - q.y);
          if (dd < q.radius * 2.4) { res.bhPasses++; flightBh = q; break; }
        }
        if (p.flyTime > C.MAX_FLY_TIME) { die('lostTime'); break; }
        if (p.x < -90 || p.x > C.WORLD_W + 90) { die('lostScreen'); break; }
      }
    }

    V.update(DT, p.y, VIEW_H, diff);
    P.consume(V.y);
    if (p.y > V.y) { die('lostVoid'); break; }
    P.prune(Math.max(V.y, p.y + VIEW_H * 1.1));
    if (res.reached >= BOT_MAX_PLANETS) { die('reached ' + BOT_MAX_PLANETS + ' (cap)'); break; }
  }
  if (!res.cause) res.cause = 'time cap ' + BOT_MAX_TIME + ' s';
  return res;
}

function runBotTests(ORB) {
  section('Bot: ' + BOT_RUNS + ' runs (launch when predict().hit is a higher unvisited planet)');
  if (!prereq('Bot simulation', ORB, {
    Planets: ['reset', 'ensure', 'update', 'impact', 'startCrumble', 'findLatch', 'blackholeKill', 'prune', 'consume'],
    Player: ['create', 'update', 'launch', 'latch', 'release'],
    Physics: ['predict', 'launchVelocity', 'stepFree', 'stepTether'],
    Void: ['reset', 'update'], Difficulty: ['get']
  })) return;
  if (!ORB.CONFIG || typeof ORB.CONFIG.VOID_START !== 'number') {
    check(false, 'Bot simulation skipped, ORB.CONFIG.VOID_START missing');
    return;
  }

  const results = [];
  const t0 = Date.now();
  for (let i = 0; i < BOT_RUNS; i++) {
    const r = guarded('bot run ' + (i + 1), () => runBot(ORB, i));
    if (!r) { results.push({ reached: 0, cause: 'exception', time: 0 }); continue; }
    results.push(r);
    const typeStr = Object.keys(r.types).map(k => k + ':' + r.types[k]).join(' ') || '-';
    info('run ' + (i + 1) + ': planets=' + r.reached + ' height=' + Math.round(r.bestHeight / 10) + ' m time=' + f1(r.time) +
      ' s launches=' + r.launches + ' avgOrbitWait=' + (r.launches ? (r.orbitWait / r.launches).toFixed(2) : '-') +
      ' s bhPasses=' + r.bhPasses + ' maxSpeed=' + Math.round(r.maxSpeed) + ' cause=' + r.cause);
    info('       planets reached by type: ' + typeStr);
  }
  const causes = {};
  results.forEach(r => { causes[r.cause] = (causes[r.cause] || 0) + 1; });
  info('death causes: ' + JSON.stringify(causes) + ' (sim wall time ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)');
  info('planets reached per run: [' + results.map(r => r.reached).join(', ') + ']');
  check(results.every(r => r.cause !== 'NaN' && r.cause !== 'exception'), 'bot runs must not produce NaN positions or exceptions');
  const good = results.filter(r => r.reached >= BOT_NEED_PLANETS).length;
  check(good >= BOT_NEED_RUNS, 'bot should climb >= ' + BOT_NEED_PLANETS + ' planets in >= ' + BOT_NEED_RUNS + ' of ' +
    BOT_RUNS + ' runs (got ' + good + ': ' + results.map(r => r.reached).join(', ') + ')');
}

function runLogic(ORB) {
  guarded('basics', () => runBasics(ORB));
  guarded('tether tests', () => runTetherTests(ORB));
  guarded('gravity tests', () => runGravityTests(ORB));
  guarded('predict tests', () => runPredictTests(ORB));
  guarded('bot tests', () => runBotTests(ORB));
}

function finish() {
  section('Summary');
  console.log('  seed ' + SEED + ', passed checks: ' + passes + ', failed: ' + failures.length);
  if (failures.length) {
    console.log('  Failures:');
    failures.forEach(f => console.log('    - ' + f));
    console.log('  RESULT: FAIL');
    process.exitCode = 1;
  } else {
    console.log('  RESULT: OK');
  }
}

function main() {
  section('Load files (SPEC load order)');
  let files;
  try {
    files = readLoadOrder();
  } catch (e) {
    check(false, 'cannot read load order from SPEC.md (' + e.message + '), using built-in list');
    files = FALLBACK_ORDER;
  }
  checkIndexHtml(files);
  reseed(SEED);
  const sandbox = makeSandbox();
  let loaded = 0;
  for (const rel of files) {
    let code;
    try {
      code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    } catch (e) {
      check(false, 'missing file ' + rel);
      continue;
    }
    try {
      vm.runInContext(code, sandbox, { filename: rel });
      check(true, 'load ' + rel);
      loaded++;
    } catch (e) {
      check(false, 'file ' + rel + ' threw while loading: ' + errText(e));
    }
  }
  info('loaded ' + loaded + '/' + files.length + ' files');
  const ORB = sandbox.ORB;
  if (!ORB || typeof ORB !== 'object') {
    check(false, 'window.ORB was not created');
    return finish();
  }
  checkApi(ORB);

  section('Logic simulation (no DOM, seed ' + SEED + ')');
  runLogic(ORB);
  finish();
}

try {
  main();
} catch (e) {
  check(false, 'checker crashed: ' + errText(e));
  finish();
}
