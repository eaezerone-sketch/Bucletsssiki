#!/usr/bin/env node
'use strict';
// Headless check for ORBITA. Loads js/*.js in SPEC load order into a vm sandbox,
// verifies the ORB API listed in SPEC.md, then runs a DOM-free logic simulation.
// Usage (repo root): node tools/check.js   -> exit 0 on success, 1 on any failure.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const DT = 1 / 60;
const EPS = 1e-6;

let passes = 0;
const failures = [];

function check(cond, msg) {
  if (cond) { passes++; return true; }
  failures.push(msg);
  console.log('  FAIL: ' + msg);
  return false;
}
function section(title) { console.log('\n== ' + title); }
function errText(e) { return e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : String(e); }
function guarded(name, fn) {
  try { fn(); } catch (e) { check(false, name + ' threw: ' + errText(e)); }
}

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

// ---- SPEC parsing ----
function readLoadOrder() {
  const spec = fs.readFileSync(path.join(ROOT, 'SPEC.md'), 'utf8');
  const at = spec.indexOf('## File list and load order');
  if (at < 0) throw new Error('SPEC.md has no "File list and load order" section');
  const m = /```[^\n]*\n([\s\S]*?)```/.exec(spec.slice(at));
  if (!m) throw new Error('SPEC.md: no code block after "File list and load order"');
  return m[1].split(/\s+/).filter(s => /\.js$/.test(s));
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
  const sandbox = {
    navigator: { language: 'ru' },
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
    devicePixelRatio: 1,
    Math: Math,
    console: console
  };
  vm.createContext(sandbox);
  sandbox.window = sandbox;
  return sandbox;
}

// ---- API contract from SPEC.md ----
const I18N_KEYS = ['title', 'subtitle', 'play', 'resume', 'restart', 'menu', 'paused', 'gameOver',
  'score', 'best', 'newBest', 'tapHint', 'soundOn', 'soundOff', 'skins', 'locked', 'perfect',
  'shield', 'magnet', 'slow', 'lostTime', 'lostScreen', 'lostAsteroid', 'planets'];

const EXPECT = [
  ['CONFIG', { values: ['WORLD_W', 'MIN_VIEW_H', 'MAX_DPR', 'LAUNCH_SPEED', 'MAX_FLY_TIME', 'OFFSCREEN_MARGIN',
    'CAPTURE_PAD', 'ORBIT_GAP', 'PLAYER_RADIUS', 'TRAIL_LEN', 'CAMERA_LERP', 'CAMERA_LEAD', 'PERFECT_TIME',
    'MAX_COMBO', 'PLANET_POINTS', 'STAR_POINTS', 'MAGNET_TIME', 'MAGNET_RADIUS', 'SLOW_TIME', 'SLOW_FACTOR',
    'DEATH_DELAY', 'COLORS'] }],
  ['M', { fns: ['clamp', 'lerp', 'dist', 'dist2', 'rand', 'randInt', 'pick', 'chance', 'angle', 'wrapAngle',
    'easeOutCubic', 'hsl', 'circleHit'] }],
  ['Storage', { fns: ['get', 'set', 'getBest', 'setBest'] }],
  ['I18N', { fns: ['t'], props: ['lang'] }],
  ['View', { fns: ['init', 'resize', 'onResize', 'worldTransform', 'screenTransform'],
    props: ['cssW', 'cssH', 'dpr', 'scale', 'w', 'h'] }],
  ['Input', { fns: ['init', 'onTap', 'onPause'] }],
  ['Audio', { fns: ['unlock', 'play', 'setMuted', 'isMuted', 'toggle'] }],
  ['Haptics', { fns: ['buzz', 'setEnabled', 'isEnabled'] }],
  ['Camera', { fns: ['reset', 'update', 'shake', 'getX', 'getY'], props: ['x', 'y', 'shakeT', 'shakeMag'] }],
  ['Difficulty', { fns: ['get'] }],
  ['Planets', { fns: ['reset', 'ensure', 'update', 'prune', 'findCapture', 'highest'], props: ['list'] }],
  ['Stars', { fns: ['reset', 'spawnBetween', 'update', 'prune'], props: ['list'] }],
  ['Asteroids', { fns: ['reset', 'maybeSpawn', 'update', 'destroy', 'prune'], props: ['list'] }],
  ['Powerups', { fns: ['reset', 'maybeSpawnBetween', 'update', 'prune'], props: ['list'] }],
  ['Player', { fns: ['create', 'update', 'launch', 'capture', 'tangent'] }],
  ['Score', { fns: ['reset', 'addPlanet', 'addStar'], props: ['value', 'combo', 'planets', 'stars'] }],
  ['Particles', { fns: ['reset', 'burst', 'ring', 'update', 'draw'] }],
  ['Skins', { fns: ['isUnlocked', 'currentId', 'current', 'select', 'name'], props: ['list'] }],
  ['Background', { fns: ['init', 'draw'] }],
  ['RenderPlanets', { fns: ['draw'] }],
  ['RenderEntities', { fns: ['draw'] }],
  ['RenderPlayer', { fns: ['draw'] }],
  ['HUD', { fns: ['init', 'show', 'hide', 'setScore', 'setCombo', 'setPowerups', 'flash'] }],
  ['Screens', { fns: ['init', 'show', 'hideAll', 'current'] }],
  ['Tutorial', { fns: ['shouldShow', 'show', 'hide', 'done'] }],
  ['Game', { fns: ['init', 'start', 'pause', 'resume', 'togglePause', 'toMenu'] }]
];

function checkApi(ORB) {
  section('API presence (SPEC sections)');
  const missing = [];
  for (const [mod, spec] of EXPECT) {
    const obj = ORB[mod];
    if (!obj || (typeof obj !== 'object' && typeof obj !== 'function')) { missing.push('ORB.' + mod); continue; }
    (spec.values || []).forEach(k => { if (obj[k] === undefined) missing.push('ORB.' + mod + '.' + k); });
    (spec.fns || []).forEach(f => { if (typeof obj[f] !== 'function') missing.push('ORB.' + mod + '.' + f + '()'); });
    (spec.props || []).forEach(p => { if (!(p in obj)) missing.push('ORB.' + mod + '.' + p); });
  }
  missing.forEach(m => check(false, 'missing ' + m));
  if (missing.length === 0) check(true, 'all ' + EXPECT.length + ' ORB modules and their members present');
  else console.log('  missing count: ' + missing.length);

  if (ORB.I18N && typeof ORB.I18N.t === 'function') {
    const iss = new Issues();
    I18N_KEYS.forEach(k => iss.add('no translation for key ' + k, ORB.I18N.t(k) === k));
    iss.report('I18N keys');
  }
}

// ---- headless logic simulation ----
function runLogic(ORB) {
  const C = ORB.CONFIG, M = ORB.M, P = ORB.Planets;
  const d0 = ORB.Difficulty.get(0);

  section('Math helpers');
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

  section('Storage / Difficulty / Skins');
  guarded('Storage', () => {
    ORB.Storage.set('check.tmp', { a: 1 });
    check(ORB.Storage.get('check.tmp', null).a === 1, 'Storage set/get roundtrip');
    check(ORB.Storage.get('check.missing', 'def') === 'def', 'Storage.get default on missing key');
    ORB.Storage.setBest(42);
    check(ORB.Storage.getBest() === 42, 'Storage.getBest/setBest');
  });
  guarded('Difficulty', () => {
    const late = ORB.Difficulty.get(60);
    check(d0.asteroidRate === 0 && d0.moveChance === 0, 'Difficulty.get(0): no asteroids or moving planets expected');
    check(late.angularSpeed >= d0.angularSpeed && late.asteroidRate > 0 && late.moveChance > 0,
      'Difficulty should ramp up with planets');
    check(late.angularSpeed <= 3.2 + EPS && late.gapMax <= 300 + EPS, 'Difficulty.get(60) above SPEC ceiling');
  });
  guarded('Skins', () => {
    check(ORB.Skins.list.length === 6, 'Skins.list should have 6 skins');
    check(ORB.Skins.current() && typeof ORB.Skins.current().color === 'string', 'Skins.current() has no color');
    check(ORB.Skins.isUnlocked(ORB.Skins.list[0], 0) === true, 'first skin should be unlocked at 0 points');
  });

  section('Planets: reset / ensure / spacing / bounds');
  guarded('Planets', () => {
    P.reset();
    const first = P.list[0];
    check(P.list.length === 1 && first.x === C.WORLD_W / 2 && first.y === 0 && first.radius === 30 &&
      first.visited === true && first.moveAmp === 0,
      'Planets.reset(): expected one static, visited planet, radius 30, at (WORLD_W/2, 0)');
    const made = P.ensure(-3000, d0);
    const list = P.list;
    check(Array.isArray(made) && made.length === list.length - 1,
      'Planets.ensure() must return exactly the newly created planets');
    check(list.length > 5, 'Planets.ensure(-3000) created only ' + (list.length - 1) + ' planets');
    check(list[list.length - 1].y <= -3000 && (list.length < 2 || list[list.length - 2].y > -3000),
      'ensure(-3000) must stop once the highest planet is above -3000');
    check(P.highest() === list[list.length - 1], 'Planets.highest() must return the last planet');
    check(P.ensure(-3000, d0).length === 0, 'second ensure() with the same topY must create nothing');

    const iss = new Issues();
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1], b = list[i];
      const ax = a.baseX !== undefined ? a.baseX : a.x;
      const bx = b.baseX !== undefined ? b.baseX : b.x;
      const gap = a.y - b.y;
      iss.add('vertical gap outside [gapMin,gapMax]', gap < d0.gapMin - EPS || gap > d0.gapMax + EPS);
      iss.add('radius outside [radiusMin,radiusMax]', b.radius < d0.radiusMin - EPS || b.radius > d0.radiusMax + EPS);
      iss.add('orbitRadius != radius + ORBIT_GAP', Math.abs(b.orbitRadius - (b.radius + C.ORBIT_GAP)) > EPS);
      iss.add('angularSpeed outside diff*[0.9,1.1]',
        b.angularSpeed < d0.angularSpeed * 0.9 - EPS || b.angularSpeed > d0.angularSpeed * 1.1 + EPS);
      iss.add('x outside [orbitRadius+12, WORLD_W-orbitRadius-12]',
        bx < b.orbitRadius + 12 - EPS || bx > C.WORLD_W - b.orbitRadius - 12 + EPS);
      iss.add('centre distance to previous < prev.orbitRadius+orbitRadius+50',
        Math.hypot(bx - ax, b.y - a.y) < a.orbitRadius + b.orbitRadius + 50 - 1e-3);
      iss.add('horizontal offset to previous < 40', Math.abs(bx - ax) < 40 - 1e-3);
      iss.add('ids not increasing', b.id <= a.id);
      iss.add('hue outside 0..360', b.hue < 0 || b.hue > 360);
    }
    iss.report('Planets spacing/bounds (static, difficulty 0)');

    // Moving planets at a later difficulty
    P.reset();
    P.ensure(-3000, ORB.Difficulty.get(40));
    const movers = P.list.filter(p => p.moveAmp > 0);
    check(movers.length > 0, 'Difficulty 40: expected some moving planets');
    const mi = new Issues();
    for (let s = 0; s < 1200; s++) P.update(DT);
    for (const m of P.list) {
      if (!(m.moveAmp > 0)) continue;
      mi.add('moving planet orbit leaves world width (baseX +- moveAmp)',
        m.baseX - m.moveAmp < -EPS || m.baseX + m.moveAmp > C.WORLD_W + EPS);
      mi.add('moving planet x outside world after 20 s', m.x < -EPS || m.x > C.WORLD_W + EPS);
      mi.add('moving planet x not finite', !isFinite(m.x));
    }
    mi.report('Moving planets');
  });

  section('Player: create / orbit / random launches');
  guarded('Player', () => {
    P.reset();
    P.ensure(-1200, d0);
    const planet0 = P.list[0];
    const pl = ORB.Player.create(planet0);
    check(pl.state === 'orbit' && pl.planet === planet0 && pl.dir === 1 && pl.orbitDist === planet0.orbitRadius &&
      Array.isArray(pl.trail) && pl.trail.length === 0 && pl.fromPlanet === null,
      'Player.create: wrong initial fields');
    for (let s = 0; s < 120; s++) { P.update(DT); ORB.Player.update(pl, DT); }
    const r = M.dist(pl.x, pl.y, planet0.x, planet0.y);
    check(Math.abs(r - planet0.orbitRadius) < 0.5,
      'orbiting player should stay ~orbitRadius from its planet (got ' + r.toFixed(2) + ')');
    const t = ORB.Player.tangent(pl);
    check(Math.abs(Math.hypot(t.x, t.y) - 1) < 1e-6, 'Player.tangent should be a unit vector');

    const TRIALS = 500;
    const iss = new Issues();
    let current = planet0;
    let p = pl;
    let launches = 0, captures = 0, timeouts = 0, offscreen = 0, newPlanets = 0;
    for (let trial = 0; trial < TRIALS; trial++) {
      const wait = M.randInt(0, 300); // random orbit phase, up to 5 s
      for (let s = 0; s < wait; s++) { P.update(DT); ORB.Player.update(p, DT); }
      if (p.state !== 'orbit' || p.planet !== current) {
        iss.add('player not orbiting current planet before launch', true);
        p = ORB.Player.create(current);
      }

      ORB.Player.launch(p);
      launches++;
      const from = p.fromPlanet;
      iss.add('launch did not set state/planet/fromPlanet',
        p.state !== 'fly' || p.planet !== null || from !== current);
      iss.add('launch speed != LAUNCH_SPEED', Math.abs(Math.hypot(p.vx, p.vy) - C.LAUNCH_SPEED) > 1e-3);

      let outcome = 'timeout', hit = null;
      for (let s = 0; s < 400; s++) { // ~6.6 s, longer than MAX_FLY_TIME
        P.update(DT);
        ORB.Player.update(p, DT);
        if (!isFinite(p.x) || !isFinite(p.y)) { iss.add('NaN position in flight', true); outcome = 'nan'; break; }
        hit = P.findCapture(p.x, p.y, from);
        if (hit) {
          iss.add('findCapture returned the excluded planet', hit === from);
          outcome = 'capture';
          break;
        }
        if (p.flyTime > C.MAX_FLY_TIME) { outcome = 'timeout'; break; }
        if (Math.abs(p.x - C.WORLD_W / 2) > C.WORLD_W) { outcome = 'offscreen'; break; }
      }

      if (outcome === 'capture') {
        captures++;
        ORB.Player.capture(p, hit);
        iss.add('capture left wrong state/planet/velocity',
          p.state !== 'orbit' || p.planet !== hit || p.vx !== 0 || p.vy !== 0);
        iss.add('capture produced non-finite angle/orbitDist', !isFinite(p.angle) || !isFinite(p.orbitDist));
        hit.visited = true;
        current = hit;
        const made = P.ensure(p.y - 1200, ORB.Difficulty.get(captures));
        newPlanets += made.length;
        let prevY = hit.y, order = true;
        for (const q of made) { if (q.y >= prevY) order = false; prevY = q.y; }
        iss.add('ensure created planets out of order', !order);
        P.prune(p.y + 1500);
        iss.add('current planet was pruned', P.list.indexOf(current) < 0);
      } else if (outcome === 'timeout') {
        timeouts++;
      } else if (outcome === 'offscreen') {
        offscreen++;
      }
      p = ORB.Player.create(current); // next attempt: fresh orbit on the current planet
    }
    iss.report('Random launches');
    console.log('  launches=' + launches + ' captures=' + captures + ' timeouts=' + timeouts +
      ' offscreen=' + offscreen + ' planetsCreated=' + newPlanets + ' planetsInList=' + P.list.length);
    check(captures > 0, 'no capture in ' + launches + ' random launches');
  });

  section('Stars / Asteroids / Powerups / Score');
  guarded('Stars', () => {
    const d = ORB.Difficulty.get(10), pl = P.list;
    ORB.Stars.reset();
    for (let i = 1; i < Math.min(pl.length, 30); i++) ORB.Stars.spawnBetween(pl[i - 1], pl[i], d);
    check(Array.isArray(ORB.Stars.list), 'Stars.list must be an array');
    check(ORB.Stars.list.length > 0, 'Stars.spawnBetween placed no stars (starChance ' + d.starChance + ')');
    const actor = ORB.Player.create(pl[0]);
    let collected = 0;
    for (const st of ORB.Stars.list.slice()) {
      actor.x = st.x;
      actor.y = st.y;
      const n = ORB.Stars.update(DT, actor);
      if (typeof n !== 'number') { check(false, 'Stars.update must return a number'); break; }
      collected += n;
      for (let k = 0; k < n; k++) ORB.Score.addStar();
    }
    check(collected > 0, 'teleporting the player onto stars collected none');
    check(ORB.Stars.list.every(s => !s.collected), 'collected stars must be removed from Stars.list');
    ORB.Stars.prune(1e9);
    console.log('  stars placed=' + (collected > 0 ? 'ok' : 'none') + ' collected=' + collected);
  });

  guarded('Asteroids', () => {
    const d = ORB.Difficulty.get(10), pl = P.list;
    ORB.Asteroids.reset();
    const actor = ORB.Player.create(pl[0]);
    const viewW = 420, viewH = 640, camY = actor.y;
    const iss = new Issues();
    let spawned = 0, maxAlive = 0, hits = 0;
    for (let s = 0; s < 60 * 90; s++) {
      const before = ORB.Asteroids.list.length;
      ORB.Asteroids.maybeSpawn(DT, camY, viewW, viewH, d);
      const mid = ORB.Asteroids.list.length;
      if (mid > before) spawned += mid - before;
      maxAlive = Math.max(maxAlive, mid);
      const hit = ORB.Asteroids.update(DT, actor);
      iss.add('update() must return an asteroid or null', hit !== null && typeof hit !== 'object');
      if (hit) { hits++; ORB.Asteroids.destroy(hit); }
    }
    for (const a of ORB.Asteroids.list) {
      iss.add('asteroid r outside [10,20]', a.r < 10 - EPS || a.r > 20 + EPS);
      iss.add('asteroid verts count not in 9..12', !a.verts || a.verts.length < 9 || a.verts.length > 12);
    }
    iss.report('Asteroids fields');
    check(spawned > 0, 'Asteroids.maybeSpawn never spawned in 90 s (asteroidRate ' + d.asteroidRate + ')');
    check(maxAlive <= 6, 'Asteroids: ' + maxAlive + ' alive at once (max 6)');
    ORB.Asteroids.prune(camY + viewH);
    console.log('  asteroids spawned=' + spawned + ' maxAlive=' + maxAlive + ' hitsOnPlayer=' + hits);
  });

  guarded('Powerups', () => {
    const d = ORB.Difficulty.get(60), pl = P.list;
    ORB.Powerups.reset();
    for (let rep = 0; rep < 8; rep++) {
      for (let i = 1; i < pl.length; i++) ORB.Powerups.maybeSpawnBetween(pl[i - 1], pl[i], d);
    }
    const spawnedCount = ORB.Powerups.list.length;
    check(spawnedCount > 0, 'Powerups.maybeSpawnBetween spawned nothing (powerChance ' + d.powerChance + ')');
    check(ORB.Powerups.list.every(q => q.kind === 'shield' || q.kind === 'magnet' || q.kind === 'slow'),
      'Powerups with unknown kind');
    const actor = ORB.Player.create(pl[0]);
    const got = {};
    for (const pu of ORB.Powerups.list.slice()) {
      actor.x = pu.x;
      actor.y = pu.y;
      const kinds = ORB.Powerups.update(DT, actor);
      if (!Array.isArray(kinds)) { check(false, 'Powerups.update must return an array'); break; }
      kinds.forEach(k => { got[k] = (got[k] || 0) + 1; });
    }
    check(Object.keys(got).length > 0, 'teleporting onto power-ups collected none');
    check(ORB.Powerups.list.every(q => !q.collected), 'collected power-ups must be removed');
    ORB.Powerups.prune(1e9);
    console.log('  powerups spawned=' + spawnedCount + ' collected=' + JSON.stringify(got));
  });

  guarded('Score', () => {
    ORB.Score.reset();
    const a = ORB.Score.addPlanet(0.3);
    check(a.perfect === true && a.combo === 2 && a.points === C.PLANET_POINTS * 2,
      'Score.addPlanet(0.3) should be perfect with combo 2');
    const b = ORB.Score.addPlanet(2.0);
    check(b.perfect === false && b.combo === 1 && b.points === C.PLANET_POINTS,
      'Score.addPlanet(2.0) should reset combo to 1');
    const s = ORB.Score.addStar();
    check(s === C.STAR_POINTS * ORB.Score.combo, 'Score.addStar points = STAR_POINTS * combo');
    check(ORB.Score.planets === 2 && ORB.Score.stars === 1 && ORB.Score.value === a.points + b.points + s,
      'Score totals (planets, stars, value) inconsistent');
    ORB.Score.reset();
    for (let i = 0; i < 10; i++) ORB.Score.addPlanet(0.1);
    check(ORB.Score.combo === C.MAX_COMBO, 'combo should cap at MAX_COMBO');
  });
}

function finish() {
  section('Summary');
  console.log('  passed checks: ' + passes + ', failed: ' + failures.length);
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
    check(false, 'cannot read load order: ' + e.message);
    return finish();
  }
  const sandbox = makeSandbox();
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
      console.log('  loaded ' + rel);
    } catch (e) {
      check(false, 'file ' + rel + ' threw while loading: ' + errText(e));
    }
  }
  const ORB = sandbox.ORB;
  if (!ORB || typeof ORB !== 'object') {
    check(false, 'window.ORB was not created');
    return finish();
  }
  checkApi(ORB);

  section('Logic simulation (no DOM)');
  guarded('simulation', () => runLogic(ORB));
  finish();
}

try {
  main();
} catch (e) {
  check(false, 'checker crashed: ' + errText(e));
  finish();
}
