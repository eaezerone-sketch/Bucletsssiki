(function () {
  'use strict';
  var ORB = window.ORB = window.ORB || {};

  // States: 'menu' | 'play' | 'pause' | 'dying' | 'over'
  var state = 'menu';
  var canvas = null, ctx = null;
  var player = null;
  var time = 0, lastT = null;
  var deathT = 0, deathReason = '';
  var tutorialOn = false;
  var booted = false;

  // Per-run bookkeeping
  var flightId = 0;          // increments every time the ship starts a free flight
  var launchAng = 0;         // direction of the current flight at launch
  var bendValid = false;     // false after a wormhole jump (angle comparison is meaningless)
  var gravityChecked = false;
  var tutSeen = {};          // tutorial names already requested this run
  var runAch = [];           // achievements unlocked during this run
  var achDirty = false, achTimer = 0;
  var dangerS = 0;           // smoothed void danger 0..1
  var voidWarnCd = 0;
  var emberT = 0;
  var diffN = -1, diffObj = null;
  var musicWanted = false, musicRunning = false;
  var errSeen = {};
  var lastHeight = -1, lastVoidHud = -1;

  // ---------- safety helpers ----------

  function logOnce(tag, e) {
    if (errSeen[tag]) return;
    errSeen[tag] = true;
    try { console.error('[ORBITA] error in ' + tag + ':', e); } catch (x) { /* ignore */ }
  }

  // Call ORB[mod][fn](...) if it exists; never throws. Returns the result.
  function opt(mod, fn, a, b, c, d, e, f, g) {
    var m = ORB[mod];
    if (!m || typeof m[fn] !== 'function') return undefined;
    try {
      return m[fn](a, b, c, d, e, f, g);
    } catch (err) {
      logOnce(mod + '.' + fn, err);
      return undefined;
    }
  }

  function t(key) {
    try { return ORB.I18N.t(key); } catch (e) { return key; }
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function getDiff() {
    var n = ORB.Score.planets;
    if (n !== diffN || !diffObj) {
      diffN = n;
      diffObj = ORB.Difficulty.get(n);
    }
    return diffObj;
  }

  function zoomNow() {
    var z = ORB.Camera.getZoom ? ORB.Camera.getZoom() : ORB.Camera.zoom;
    return z > 0 ? z : 1;
  }

  function planetColor(p) {
    return ORB.M.hsl(p.hue || 200, 80, 65);
  }

  // World-space popup, falls back to the HUD flash when FX is missing.
  function say(x, y, text, color, size) {
    if (ORB.FX && typeof ORB.FX.popup === 'function') opt('FX', 'popup', x, y, text, color, size);
    else opt('HUD', 'flash', text, color);
  }

  // ---------- music ----------

  function startMusic() {
    musicWanted = true;
    if (musicRunning) return;
    musicRunning = true;
    opt('Music', 'setMuted', ORB.Audio.isMuted());
    opt('Music', 'start');
  }

  function stopMusic() {
    if (!musicRunning) return;
    musicRunning = false;
    opt('Music', 'stop');
  }

  // ---------- achievements ----------

  function checkAch() {
    var A = ORB.Achievements;
    if (!A || typeof A.check !== 'function') return;
    var got;
    try { got = A.check(ORB.Score.stats()) || []; } catch (e) { logOnce('Achievements.check', e); return; }
    for (var i = 0; i < got.length; i++) {
      runAch.push(got[i]);
      var name = '';
      try { name = A.name(got[i]); } catch (e2) { name = got[i].id || ''; }
      opt('HUD', 'toast', t('achievementUnlocked'), name);
      opt('Audio', 'play', 'achievement');
    }
  }

  // ---------- tutorials ----------

  function tut(name) {
    if (tutorialOn || tutSeen[name]) return;
    tutSeen[name] = true;
    opt('Tutorial', 'step', name);
  }

  // ---------- world generation ----------

  // Previous non-blackhole planet in the chain before planet c.
  function prevChain(c) {
    var list = ORB.Planets.list;
    for (var j = list.indexOf(c) - 1; j >= 0; j--) {
      if (list[j].type !== 'blackhole') return list[j];
    }
    return null;
  }

  // Generate planets above the camera, plus stars, power-ups and wormholes in the gaps.
  function ensureAhead() {
    var diff = getDiff();
    var topY = ORB.Camera.y - ORB.View.visibleH(zoomNow()) * 1.2;
    var created = ORB.Planets.ensure(topY, diff) || [];
    for (var i = 0; i < created.length; i++) {
      var p = created[i];
      if (p.type === 'blackhole') continue;
      var prev = prevChain(p);
      if (!prev) continue;
      ORB.Stars.spawnBetween(prev, p, diff);
      ORB.Powerups.maybeSpawnBetween(prev, p, diff);
      opt('Wormholes', 'maybeSpawnBetween', prev, p, diff);
    }
  }

  // Remove everything that has fallen far below.
  function pruneWorld() {
    var vy = (ORB.Void && typeof ORB.Void.y === 'number') ? ORB.Void.y : -Infinity;
    var bottomY = Math.max(vy, ORB.Camera.y + ORB.View.visibleH(zoomNow()));
    ORB.Planets.prune(bottomY);
    ORB.Stars.prune(bottomY);
    ORB.Asteroids.prune(bottomY);
    ORB.Powerups.prune(bottomY);
    opt('Comets', 'prune', bottomY, ORB.View.visibleW(zoomNow()));
    opt('Wormholes', 'prune', bottomY);
  }

  function setupWorld() {
    var CFG = ORB.CONFIG;
    ORB.Planets.reset();
    ORB.Stars.reset();
    ORB.Asteroids.reset();
    ORB.Powerups.reset();
    opt('Comets', 'reset');
    opt('Wormholes', 'reset');
    ORB.Particles.reset();
    opt('FX', 'reset');
    opt('TimeFX', 'reset');
    ORB.Score.reset();
    player = ORB.Player.create(ORB.Planets.list[0]);
    opt('Void', 'reset', player.planet.y + CFG.VOID_START);
    ORB.Camera.reset(CFG.WORLD_W / 2, player.planet.y - ORB.View.h * CFG.CAMERA_LEAD);
    flightId = 0;
    launchAng = 0;
    bendValid = false;
    gravityChecked = false;
    tutSeen = {};
    runAch = [];
    achDirty = false;
    achTimer = 0;
    dangerS = 0;
    voidWarnCd = 0;
    emberT = 0;
    diffN = -1;
    diffObj = null;
    lastHeight = -1;
    lastVoidHud = -1;
    opt('FX', 'setDanger', 0);
    opt('FX', 'setSpeed', 0);
    ensureAhead();
  }

  // ---------- game flow ----------

  function start() {
    setupWorld();
    state = 'play';
    ORB.Screens.hideAll();
    ORB.HUD.show();
    ORB.HUD.setScore(0);
    ORB.HUD.setCombo(1);
    opt('HUD', 'setHeight', 0);
    opt('HUD', 'setVoid', 0);
    tutorialOn = !!ORB.Tutorial.shouldShow();
    if (tutorialOn) ORB.Tutorial.show();
    startMusic();
  }

  function pause() {
    if (state !== 'play') return;
    state = 'pause';
    ORB.Screens.show('pause');
    stopMusic();
  }

  function resume() {
    if (state !== 'pause') return;
    state = 'play';
    lastT = null; // avoid a dt spike after the pause
    ORB.Screens.hideAll();
    startMusic();
  }

  function togglePause() {
    if (state === 'play') pause();
    else if (state === 'pause') resume();
  }

  function toMenu() {
    ORB.Tutorial.hide();
    tutorialOn = false;
    setupWorld();
    state = 'menu';
    ORB.HUD.hide();
    ORB.Screens.show('menu', { best: ORB.Storage.getBest() });
    if (musicWanted) startMusic();
  }

  function die(reason) {
    var CFG = ORB.CONFIG, p = player;
    state = 'dying';
    deathT = 0;
    deathReason = reason;
    p.state = 'dead';
    ORB.Tutorial.hide();
    tutorialOn = false;
    ORB.Particles.burst(p.x, p.y, CFG.COLORS.danger, 40, 240, 0.9);
    opt('Particles', 'debris', p.x, p.y, CFG.COLORS.danger, 14);
    opt('FX', 'shockwave', p.x, p.y, CFG.COLORS.danger, 130);
    opt('FX', 'flash', CFG.COLORS.danger, 0.45);
    opt('FX', 'setSpeed', 0);
    ORB.Camera.shake(10, 0.4);
    opt('TimeFX', 'slowmo', 0.3, 0.8);
    ORB.Audio.play('death');
    if (reason === 'lostVoid') opt('Audio', 'play', 'void');
    else if (reason === 'lostStar') opt('Audio', 'play', 'burn');
    opt('Haptics', 'buzz', [30, 40, 60]);
  }

  function finishDeath() {
    var score = ORB.Score.value;
    var best = ORB.Storage.getBest();
    var newBest = score > best;
    if (newBest) {
      ORB.Storage.setBest(score);
      best = score;
    }
    checkAch();
    opt('HUD', 'setVoid', 0);
    opt('FX', 'setDanger', 0);
    ORB.HUD.hide();
    state = 'over';
    ORB.Screens.show('over', {
      score: score,
      best: best,
      newBest: newBest,
      planets: ORB.Score.planets,
      reason: deathReason,
      stats: ORB.Score.stats(),
      newAchievements: runAch.slice()
    });
  }

  // ---------- gameplay events ----------

  function beginFlight() {
    flightId++;
    gravityChecked = false;
  }

  // Combo/score bonus with popup. Returns points.
  function bonus(kind, x, y, label, color, size) {
    var pts = ORB.Score.addBonus(kind) || 0;
    ORB.HUD.setScore(ORB.Score.value);
    say(x, y, label + ' +' + pts, color, size || 20);
    achDirty = true;
    return pts;
  }

  // Ship flew inside the latch zone of `hit`.
  function onLatch(hit) {
    var CFG = ORB.CONFIG, p = player;
    var flyTime = p.flyTime;
    var wasVisited = hit.visited;
    var from = p.fromPlanet;

    // How far gravity bent the path since launch.
    var bent = false;
    if (bendValid && flyTime > 0.25 && hit !== from && !wasVisited) {
      var da = Math.abs(ORB.M.wrapAngle(Math.atan2(p.vy, p.vx) - launchAng));
      bent = da > 0.873; // 50 degrees
    }

    var s = ORB.Player.latch(p, hit);
    var color = planetColor(hit);
    opt('Planets', 'impact', hit, s, p.angle);
    ORB.Audio.play('latch', s);
    ORB.Haptics.buzz(s > 0.5 ? [14, 10, 20] : 10);
    ORB.Particles.ring(hit.x, hit.y, color, hit.orbitRadius);
    ORB.Particles.burst(p.x, p.y, color, Math.round(8 + 14 * s), 110 + 200 * s, 0.5, { type: 'spark' });
    opt('FX', 'shockwave', hit.x, hit.y, color, hit.orbitRadius * (1.1 + 0.5 * s));
    ORB.Camera.shake(3 + 6 * s, 0.25);
    if (s > 0.5) opt('TimeFX', 'hitstop', 0.03 + 0.05 * s);

    hit._gWarn = false;
    hit._gEmber = 0;

    if (!wasVisited) {
      hit.visited = true;
      var r = ORB.Score.addPlanet(flyTime);
      ORB.HUD.setScore(ORB.Score.value);
      ORB.HUD.setCombo(r.combo);
      say(hit.x, hit.y - hit.radius - 18, '+' + r.points, CFG.COLORS.text, 22);
      if (r.perfect) {
        ORB.Audio.play('perfect');
        opt('FX', 'flash', CFG.COLORS.accent, 0.18);
        say(hit.x, hit.y - hit.radius - 46, t('perfect') + ' x' + r.combo, CFG.COLORS.accent, 24);
      }
      achDirty = true;
    }

    if (bent) {
      bonus('slingshot', hit.x, hit.y - hit.radius - 74, t('slingshot'), CFG.COLORS.accent2, 22);
      ORB.Audio.play('slingshot');
    }

    if (hit.type === 'crumble') {
      opt('Planets', 'startCrumble', hit);
      tut('crumble');
    } else if (hit.type === 'star') {
      tut('star');
    }
    bendValid = false;
  }

  function onTap() {
    if (state === 'menu') return start();
    if (state !== 'play' || player.state !== 'orbit') return;
    var CFG = ORB.CONFIG;
    startMusic();
    ORB.Player.launch(player);
    beginFlight();
    launchAng = Math.atan2(player.vy, player.vx);
    bendValid = true;
    ORB.Audio.play('launch');
    ORB.Haptics.buzz(8);
    ORB.Particles.burst(player.x, player.y, CFG.COLORS.accent, 12, 140, 0.4);
    if (tutorialOn) {
      ORB.Tutorial.done();
      tutorialOn = false;
    }
  }

  // Black hole passes: awards the slingshot bonus once per hole per flight.
  function blackholePass(p) {
    var CFG = ORB.CONFIG;
    var list = ORB.Planets.list;
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (b.type !== 'blackhole' || b.dead || b._gPass === flightId) continue;
      var d = ORB.M.dist(p.x, p.y, b.x, b.y);
      if (d < b.radius * 2.4) {
        b._gPass = flightId;
        ORB.Score.blackholePasses++;
        bonus('slingshot', p.x, p.y - 26, t('slingshot'), CFG.COLORS.accent2, 22);
        ORB.Audio.play('slingshot');
        opt('TimeFX', 'slowmo', 0.45, 0.6);
        opt('FX', 'flash', CFG.COLORS.accent2, 0.2);
        ORB.Haptics.buzz([10, 20, 10]);
      }
    }
  }

  // Per-planet housekeeping: star cooling, crumble debris, death effects, hints.
  function planetPass(sdt, playing) {
    var list = ORB.Planets.list;
    var cur = (player.state === 'orbit') ? player.planet : null;
    var cy = ORB.Camera.y, vh = ORB.View.visibleH(zoomNow());
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (p.type === 'star' && p !== cur && p.heat > 0) p.heat = Math.max(0, p.heat - 0.5 * sdt);
      var visible = Math.abs(p.y - cy) < vh;
      if (p.dead) {
        if (!p._gFx) {
          p._gFx = true;
          if (visible && p.type !== 'blackhole') deadFx(p);
        }
        continue;
      }
      if (p.crumble > 0 && p.crumble < 1 && visible) {
        p._gDb = (p._gDb || 0) - sdt;
        if (p._gDb <= 0) {
          p._gDb = 0.22;
          var a = Math.random() * Math.PI * 2;
          opt('Particles', 'debris', p.x + Math.cos(a) * p.radius, p.y + Math.sin(a) * p.radius,
            planetColor(p), 2);
        }
      }
      if (playing && p.type === 'blackhole' && Math.abs(p.y - cy) < vh * 0.45) tut('blackhole');
    }
  }

  // Planet crumbled or was eaten by the void.
  function deadFx(p) {
    var CFG = ORB.CONFIG;
    if (p.crumble >= 1) {
      var color = planetColor(p);
      opt('Particles', 'debris', p.x, p.y, color, 26);
      ORB.Particles.burst(p.x, p.y, color, 18, 160, 0.8, { type: 'smoke' });
      opt('FX', 'shockwave', p.x, p.y, color, p.orbitRadius * 1.4);
      ORB.Camera.shake(5, 0.25);
      ORB.Audio.play('crumble');
    } else {
      ORB.Particles.burst(p.x, p.y, CFG.COLORS.danger, 16, 140, 0.9, { type: 'ember' });
      opt('FX', 'shockwave', p.x, p.y, CFG.COLORS.danger, p.orbitRadius);
    }
  }

  // Orbiting: star overheating, crumbled planet release.
  function updateOrbit(sdt) {
    var CFG = ORB.CONFIG, p = player, pl = p.planet;
    if (!pl) return false;

    if (pl.dead && pl.crumble >= 1) {
      ORB.Player.release(p);
      beginFlight();
      bendValid = false;
      ORB.Camera.shake(6, 0.3);
      ORB.Haptics.buzz([20, 30, 20]);
      return false;
    }

    if (pl.type === 'star') {
      pl.heat = (pl.heat || 0) + CFG.STAR_HEAT_RATE * sdt;
      if (pl.heat >= 1) { die('lostStar'); return true; }
      if (pl.heat > 0.45 && !pl._gWarn) {
        pl._gWarn = true;
        say(p.x, p.y - 30, t('heat'), CFG.COLORS.danger, 22);
        ORB.Audio.play('burn');
        ORB.Haptics.buzz([15, 25, 15]);
      }
      if (pl.heat > 0.3) {
        emberT -= sdt;
        if (emberT <= 0) {
          emberT = 0.16;
          ORB.Particles.burst(p.x, p.y, CFG.COLORS.danger, 2, 70, 0.5, { type: 'ember' });
        }
      }
      if (pl.heat > 0.6) ORB.Camera.shake((pl.heat - 0.5) * 5, 0.12);
    }
    return false;
  }

  // Free flight: gravity hints, black holes, latching, bounds.
  function updateFly(sdt, px0, py0) {
    var CFG = ORB.CONFIG, p = player;

    // Black hole kill (also checks the midpoint so fast ships can't tunnel through).
    if (opt('Planets', 'blackholeKill', p.x, p.y) ||
        opt('Planets', 'blackholeKill', (p.x + px0) / 2, (p.y + py0) / 2)) {
      die('lostBlackhole');
      return true;
    }
    blackholePass(p);

    var ign = p.ignoreT > 0 ? p.ignorePlanet : null;

    if (!gravityChecked && !tutorialOn && p.flyTime > 0.15 && ORB.Physics && ORB.Physics.gravity) {
      var g = ORB.Physics.gravity(p.x, p.y, ORB.Planets.list, ign);
      if (g && Math.sqrt(g.ax * g.ax + g.ay * g.ay) > 90) {
        gravityChecked = true;
        tut('gravity');
      }
    }

    var hit = ORB.Planets.findLatch(p.x, p.y, ign);
    if (hit) {
      onLatch(hit);
    } else if (p.flyTime > CFG.MAX_FLY_TIME) {
      die('lostTime');
      return true;
    } else if (p.x < -90 || p.x > CFG.WORLD_W + 90) {
      die('lostScreen');
      return true;
    }
    return false;
  }

  function updateCamera(dt) {
    var CFG = ORB.CONFIG, p = player;
    var orbit = p.state === 'orbit' && p.planet;
    var ty = (orbit ? p.planet.y : p.y + p.vy * 0.12) - ORB.View.h * CFG.CAMERA_LEAD;
    var tx = CFG.WORLD_W / 2 + (p.x - CFG.WORLD_W / 2) * 0.25;
    var u = clamp((p.speed - CFG.ZOOM_SPEED_LO) / (CFG.ZOOM_SPEED_HI - CFG.ZOOM_SPEED_LO), 0, 1);
    u = u * u * (3 - 2 * u);
    var tz = 1 - (1 - CFG.ZOOM_MIN) * u;
    ORB.Camera.update(dt, tx, ty, tz);
  }

  // Full gameplay step (only in 'play').
  function updatePlay(dt) {
    var CFG = ORB.CONFIG, p = player, i;
    var sdt = dt * (p.slowTime > 0 ? CFG.SLOW_FACTOR : 1);
    p.magnetTime = Math.max(0, p.magnetTime - dt);
    p.slowTime = Math.max(0, p.slowTime - dt);
    var diff = getDiff();

    var px0 = p.x, py0 = p.y;
    ORB.Planets.update(sdt);
    ORB.Player.update(p, sdt);
    p.speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
    planetPass(sdt, true);

    if (p.state === 'orbit') {
      if (updateOrbit(sdt)) return;
      if (opt('Planets', 'blackholeKill', p.x, p.y)) return die('lostBlackhole');
    }
    if (p.state === 'fly') {
      if (updateFly(sdt, px0, py0)) return;
    }

    // The rising void
    var vdist = 1e9;
    if (ORB.Void && typeof ORB.Void.update === 'function') {
      opt('Void', 'update', sdt, p.y, ORB.View.h, diff);
      opt('Planets', 'consume', ORB.Void.y);
      vdist = ORB.Void.y - p.y;
      if (vdist < 0) return die('lostVoid');
      if (p.state === 'orbit' && p.planet && p.planet.dead && !(p.planet.crumble >= 1)) {
        return die('lostVoid');
      }
    }

    // Stars
    var got = ORB.Stars.update(sdt, p);
    if (got > 0) {
      var spts = 0;
      for (i = 0; i < got; i++) spts += ORB.Score.addStar();
      ORB.HUD.setScore(ORB.Score.value);
      ORB.Audio.play('star');
      ORB.Particles.burst(p.x, p.y, CFG.COLORS.star, 8 * got, 140, 0.5);
      say(p.x, p.y - 20, '+' + spts, CFG.COLORS.star, 18);
      achDirty = true;
    }

    // Power-ups
    var kinds = ORB.Powerups.update(sdt, p) || [];
    kinds.forEach(function (k) {
      if (k === 'shield') p.shield = true;
      else if (k === 'magnet') p.magnetTime = CFG.MAGNET_TIME;
      else if (k === 'slow') p.slowTime = CFG.SLOW_TIME;
      ORB.Audio.play('power');
      ORB.HUD.flash(t(k), CFG.COLORS.accent);
    });

    var vw = ORB.View.visibleW(zoomNow()), vh = ORB.View.visibleH(zoomNow());

    // Asteroids
    ORB.Asteroids.maybeSpawn(sdt, ORB.Camera.y, vw, vh, diff);
    var rock = ORB.Asteroids.update(sdt, p);
    if (rock) {
      if (p.shield) {
        p.shield = false;
        ORB.Asteroids.destroy(rock);
        ORB.Particles.burst(rock.x, rock.y, CFG.COLORS.danger, 20, 200, 0.6);
        ORB.Audio.play('shield');
        ORB.Camera.shake(5, 0.2);
      } else {
        return die('lostAsteroid');
      }
    } else {
      var near = opt('Asteroids', 'nearMiss', p);
      if (near && near.length) {
        for (i = 0; i < near.length; i++) {
          bonus('nearMiss', p.x, p.y - 24 - i * 20, t('nearMiss'), CFG.COLORS.star, 18);
          ORB.Audio.play('nearMiss');
        }
      }
    }

    // Comets
    if (ORB.Comets) {
      opt('Comets', 'maybeSpawn', sdt, ORB.Camera.y, vw, vh, diff);
      var comet = opt('Comets', 'update', sdt, p);
      if (comet && p.state === 'fly') {
        var cl = Math.sqrt(comet.vx * comet.vx + comet.vy * comet.vy) || 1;
        p.vx += comet.vx / cl * CFG.COMET_BOOST;
        p.vy += comet.vy / cl * CFG.COMET_BOOST;
        p.speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
        bendValid = false;
        bonus('comet', p.x, p.y - 26, t('cometRide'), CFG.COLORS.accent, 22);
        ORB.Audio.play('comet');
        ORB.Particles.burst(p.x, p.y, CFG.COLORS.accent, 24, 220, 0.6, { type: 'spark' });
        opt('FX', 'shockwave', p.x, p.y, CFG.COLORS.accent, 70);
        ORB.Haptics.buzz(15);
      }
    }

    // Wormholes
    if (ORB.Wormholes) {
      var warp = opt('Wormholes', 'update', sdt, p);
      if (warp && warp.from && warp.to) {
        p.trail.length = 0;
        p.speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
        bendValid = false;
        bonus('wormhole', p.x, p.y - 26, t('warp'), CFG.COLORS.accent2, 22);
        ORB.Audio.play('warp');
        opt('FX', 'shockwave', warp.from.x, warp.from.y, CFG.COLORS.accent2, 90);
        opt('FX', 'shockwave', warp.to.x, warp.to.y, CFG.COLORS.accent, 90);
        opt('FX', 'flash', CFG.COLORS.accent2, 0.3);
        ORB.Particles.burst(p.x, p.y, CFG.COLORS.accent, 24, 200, 0.6);
        ORB.Haptics.buzz([10, 20, 10]);
      }
    }

    // Score tracking, HUD, effects
    ORB.Score.setHeight(p.y);
    ORB.Score.trackSpeed(p.speed);
    if (ORB.Score.height !== lastHeight) {
      lastHeight = ORB.Score.height;
      opt('HUD', 'setHeight', lastHeight);
    }

    var danger = ORB.Void ? clamp(1 - vdist / (ORB.View.h * 0.75), 0, 1) : 0;
    dangerS += (danger - dangerS) * Math.min(1, 5 * dt);
    if (Math.abs(dangerS - lastVoidHud) > 0.01) {
      lastVoidHud = dangerS;
      opt('HUD', 'setVoid', dangerS);
    }
    opt('FX', 'setDanger', dangerS);
    opt('FX', 'setSpeed', clamp(p.speed / CFG.MAX_SPEED, 0, 1));
    opt('Music', 'setIntensity', Math.max(dangerS, ORB.Score.combo / CFG.MAX_COMBO));

    voidWarnCd -= dt;
    if (dangerS > 0.8 && voidWarnCd <= 0) {
      voidWarnCd = 10;
      ORB.HUD.flash(t('voidNear'), CFG.COLORS.danger);
      ORB.Audio.play('void');
    }
    if (vdist < ORB.View.h * 0.5) tut('void');

    updateCamera(dt);
    ORB.Particles.update(dt);
    opt('FX', 'update', dt);
    ensureAhead();
    pruneWorld();
    ORB.HUD.setPowerups({ shield: p.shield, magnet: p.magnetTime, slow: p.slowTime });

    achTimer += dt;
    if (achDirty || achTimer >= 1) {
      achDirty = false;
      achTimer = 0;
      checkAch();
    }
  }


  // Light world animation used in menu, over and dying states.
  function stepWorld(dt) {
    ORB.Planets.update(dt);
    if (player.state === 'orbit') ORB.Player.update(player, dt);
    planetPass(dt, false);
    updateCamera(dt);
    ORB.Particles.update(dt);
    opt('FX', 'update', dt);
    ensureAhead();
    pruneWorld();
  }

  function update(dt, realDt) {
    if (state === 'play') {
      updatePlay(dt);
    } else if (state === 'dying') {
      if (ORB.Void && ORB.Void.update) opt('Void', 'update', dt, player.y, ORB.View.h, getDiff());
      stepWorld(dt);
      deathT += realDt;
      if (deathT >= ORB.CONFIG.DEATH_DELAY) finishDeath();
    } else if (state === 'menu' || state === 'over') {
      stepWorld(dt);
      opt('Music', 'setIntensity', state === 'menu' ? 0.12 : 0.18);
    }
    // 'pause': world frozen
  }

  // ---------- rendering ----------

  function render() {
    var View = ORB.View, cam = ORB.Camera;
    var zoom = zoomNow();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    View.screenTransform(ctx);
    opt('Background', 'draw', ctx, cam.y, time);

    View.worldTransform(ctx, cam.getX(), cam.getY(), zoom);
    var planets = ORB.Planets.list;
    var current = (player && player.state === 'orbit') ? player.planet : null;
    opt('RenderOrbits', 'draw', ctx, planets, time, player);
    opt('RenderPlanets', 'draw', ctx, planets, time, current);
    opt('RenderEntities', 'draw', ctx, ORB.Stars.list, ORB.Asteroids.list, ORB.Powerups.list,
      ORB.Comets ? ORB.Comets.list : [], ORB.Wormholes ? ORB.Wormholes.list : [], time);
    opt('Particles', 'draw', ctx);
    if (player && player.state !== 'dead') opt('RenderPlayer', 'draw', ctx, player, time);
    opt('FX', 'drawWorld', ctx);
    opt('Void', 'draw', ctx, time, cam.getX(), View.visibleW(zoom), View.visibleH(zoom));

    View.screenTransform(ctx);
    opt('FX', 'drawScreen', ctx);
  }

  function frame(now) {
    requestAnimationFrame(frame);
    var real = lastT === null ? 0 : Math.max(0, Math.min((now - lastT) / 1000, 0.033));
    lastT = now;
    var dt = real;
    try {
      if (state !== 'pause' && ORB.TimeFX && typeof ORB.TimeFX.update === 'function') {
        dt = ORB.TimeFX.update(real);
      }
      time += state === 'pause' ? real : dt;
      update(dt, real);
    } catch (e) {
      logOnce('update', e);
    }
    try {
      render();
    } catch (e2) {
      logOnce('render', e2);
    }
  }

  function init() {
    if (booted) return;
    booted = true;
    canvas = document.getElementById('game');
    ctx = canvas.getContext('2d');
    ORB.View.init(canvas);
    ORB.Input.init(canvas);
    ORB.HUD.init({ onPause: pause });
    ORB.Screens.init({
      onPlay: function () { start(); },
      onResume: function () { resume(); },
      onRestart: function () { start(); },
      onMenu: function () { toMenu(); },
      onToggleSound: function () {
        var muted = ORB.Audio.toggle();
        opt('Music', 'setMuted', muted);
        return muted;
      }
    });
    ORB.Background.init();
    ORB.Input.onTap(onTap);
    ORB.Input.onPause(togglePause);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        pause();
        stopMusic();
      } else {
        lastT = null;
        if (musicWanted && state !== 'pause') startMusic();
      }
    });
    setupWorld();
    state = 'menu';
    ORB.Screens.show('menu', { best: ORB.Storage.getBest() });
    requestAnimationFrame(frame);
  }

  ORB.Game = {
    init: init,
    start: start,
    pause: pause,
    resume: resume,
    togglePause: togglePause,
    toMenu: toMenu,
    getState: function () { return state; },
    debug: function () { return { player: player, state: state }; }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
