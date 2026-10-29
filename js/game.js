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

  // Camera target: follow the planet when orbiting, otherwise the satellite.
  function camTarget() {
    var y = (player.state === 'orbit' && player.planet) ? player.planet.y : player.y;
    return y - ORB.View.h * ORB.CONFIG.CAMERA_LEAD;
  }

  // Generate planets above the camera, plus stars and power-ups between new planets.
  function ensureAhead() {
    var diff = ORB.Difficulty.get(ORB.Score.planets);
    var created = ORB.Planets.ensure(ORB.Camera.y - ORB.View.h * 1.2, diff) || [];
    var list = ORB.Planets.list;
    created.forEach(function (p) {
      var i = list.indexOf(p);
      if (i > 0) {
        var prev = list[i - 1];
        ORB.Stars.spawnBetween(prev, p, diff);
        ORB.Powerups.maybeSpawnBetween(prev, p, diff);
      }
    });
  }

  // Remove everything that has fallen below the visible area.
  function pruneWorld() {
    var bottomY = ORB.Camera.y + ORB.View.h;
    ORB.Planets.prune(bottomY);
    ORB.Stars.prune(bottomY);
    ORB.Asteroids.prune(bottomY);
    ORB.Powerups.prune(bottomY);
  }

  function setupWorld() {
    var CFG = ORB.CONFIG;
    ORB.Planets.reset();
    ORB.Stars.reset();
    ORB.Asteroids.reset();
    ORB.Powerups.reset();
    ORB.Particles.reset();
    ORB.Score.reset();
    player = ORB.Player.create(ORB.Planets.list[0]);
    ORB.Camera.reset(CFG.WORLD_W / 2, player.planet.y - ORB.View.h * CFG.CAMERA_LEAD);
    ensureAhead();
  }

  function start() {
    setupWorld();
    state = 'play';
    ORB.Screens.hideAll();
    ORB.HUD.show();
    ORB.HUD.setScore(0);
    ORB.HUD.setCombo(1);
    tutorialOn = !!ORB.Tutorial.shouldShow();
    if (tutorialOn) ORB.Tutorial.show();
  }

  function pause() {
    if (state !== 'play') return;
    state = 'pause';
    ORB.Screens.show('pause');
  }

  function resume() {
    if (state !== 'pause') return;
    state = 'play';
    lastT = null; // avoid a dt spike after the pause
    ORB.Screens.hideAll();
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
    ORB.Camera.shake(10, 0.4);
    ORB.Audio.play('death');
    ORB.Haptics.buzz([30, 40, 60]);
  }

  function finishDeath() {
    var score = ORB.Score.value;
    var best = ORB.Storage.getBest();
    var newBest = score > best;
    if (newBest) {
      ORB.Storage.setBest(score);
      best = score;
    }
    ORB.HUD.hide();
    state = 'over';
    ORB.Screens.show('over', {
      score: score,
      best: best,
      newBest: newBest,
      planets: ORB.Score.planets,
      reason: deathReason
    });
  }

  // Player flew into the capture zone of a planet.
  function onCapture(planet) {
    var CFG = ORB.CONFIG;
    var flyTime = player.flyTime;
    ORB.Player.capture(player, planet);
    ORB.Particles.ring(planet.x, planet.y, ORB.M.hsl(planet.hue, 80, 65), planet.orbitRadius);
    var sound = 'capture';
    if (!planet.visited) {
      planet.visited = true;
      var r = ORB.Score.addPlanet(flyTime);
      ORB.HUD.setScore(ORB.Score.value);
      ORB.HUD.setCombo(r.combo);
      if (r.perfect) {
        sound = 'perfect';
        ORB.HUD.flash(ORB.I18N.t('perfect') + ' x' + r.combo, CFG.COLORS.accent);
      }
    }
    ORB.Audio.play(sound);
  }

  function onTap() {
    if (state === 'menu') return start();
    if (state !== 'play' || player.state !== 'orbit') return;
    var CFG = ORB.CONFIG;
    ORB.Player.launch(player);
    ORB.Audio.play('launch');
    ORB.Haptics.buzz(8);
    ORB.Particles.burst(player.x, player.y, CFG.COLORS.accent, 12, 140, 0.4);
    if (tutorialOn) {
      ORB.Tutorial.done();
      tutorialOn = false;
    }
  }

  // Full gameplay step (only in 'play').
  function updatePlay(dt) {
    var CFG = ORB.CONFIG, p = player;
    var sdt = dt * (p.slowTime > 0 ? CFG.SLOW_FACTOR : 1);
    p.magnetTime = Math.max(0, p.magnetTime - dt);
    p.slowTime = Math.max(0, p.slowTime - dt);
    var diff = ORB.Difficulty.get(ORB.Score.planets);

    ORB.Planets.update(sdt);
    ORB.Player.update(p, sdt);

    if (p.state === 'fly') {
      var hit = ORB.Planets.findCapture(p.x, p.y, p.fromPlanet);
      if (hit) {
        onCapture(hit);
      } else if (p.flyTime > CFG.MAX_FLY_TIME) {
        return die('lostTime');
      } else {
        var limX = Math.min(ORB.View.w / 2, CFG.WORLD_W * 0.8) + CFG.OFFSCREEN_MARGIN;
        var limY = ORB.Camera.y + ORB.View.h / 2 + CFG.OFFSCREEN_MARGIN;
        if (Math.abs(p.x - ORB.Camera.x) > limX || p.y > limY) {
          return die('lostScreen');
        }
      }
    }

    // Stars
    var got = ORB.Stars.update(sdt, p);
    if (got > 0) {
      for (var i = 0; i < got; i++) ORB.Score.addStar();
      ORB.HUD.setScore(ORB.Score.value);
      ORB.Audio.play('star');
      ORB.Particles.burst(p.x, p.y, CFG.COLORS.star, 8 * got, 140, 0.5);
    }

    // Power-ups
    var kinds = ORB.Powerups.update(sdt, p) || [];
    kinds.forEach(function (k) {
      if (k === 'shield') p.shield = true;
      else if (k === 'magnet') p.magnetTime = CFG.MAGNET_TIME;
      else if (k === 'slow') p.slowTime = CFG.SLOW_TIME;
      ORB.Audio.play('power');
      ORB.HUD.flash(ORB.I18N.t(k), CFG.COLORS.accent);
    });

    // Asteroids
    ORB.Asteroids.maybeSpawn(sdt, ORB.Camera.y, ORB.View.w, ORB.View.h, diff);
    var rock = ORB.Asteroids.update(sdt, p);
    if (rock) {
      if (p.shield) {
        p.shield = false;
        ORB.Asteroids.destroy(rock);
        ORB.Particles.burst(rock.x, rock.y, CFG.COLORS.danger, 20, 200, 0.6);
        ORB.Audio.play('shield');
      } else {
        return die('lostAsteroid');
      }
    }

    ORB.Camera.update(dt, camTarget());
    ORB.Particles.update(dt);
    ensureAhead();
    pruneWorld();
    ORB.HUD.setPowerups({ shield: p.shield, magnet: p.magnetTime, slow: p.slowTime });
  }

  // Light world animation used in menu, over and dying states.
  function stepWorld(dt) {
    ORB.Planets.update(dt);
    if (player.state === 'orbit') ORB.Player.update(player, dt);
    ORB.Camera.update(dt, camTarget());
    ORB.Particles.update(dt);
    ensureAhead();
    pruneWorld();
  }

  function update(dt) {
    if (state === 'play') {
      updatePlay(dt);
    } else if (state === 'dying') {
      stepWorld(dt);
      deathT += dt;
      if (deathT >= ORB.CONFIG.DEATH_DELAY) finishDeath();
    } else if (state === 'menu' || state === 'over') {
      stepWorld(dt);
    }
    // 'pause': world frozen
  }

  function render() {
    ORB.View.screenTransform(ctx);
    ORB.Background.draw(ctx, ORB.Camera.y, time);
    ORB.View.worldTransform(ctx, ORB.Camera.getX(), ORB.Camera.getY());
    var current = (player && player.state === 'orbit') ? player.planet : null;
    ORB.RenderPlanets.draw(ctx, ORB.Planets.list, time, current);
    ORB.RenderEntities.draw(ctx, ORB.Stars.list, ORB.Asteroids.list, ORB.Powerups.list, time);
    ORB.Particles.draw(ctx);
    ORB.RenderPlayer.draw(ctx, player, time);
  }

  function frame(now) {
    var dt = lastT === null ? 0 : Math.max(0, Math.min((now - lastT) / 1000, 0.033));
    lastT = now;
    time += dt;
    update(dt);
    render();
    requestAnimationFrame(frame);
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
      onToggleSound: function () { return ORB.Audio.toggle(); }
    });
    ORB.Background.init();
    ORB.Input.onTap(onTap);
    ORB.Input.onPause(togglePause);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) pause();
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
    getState: function () { return state; }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
