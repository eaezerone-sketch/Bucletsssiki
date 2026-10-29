# ORBITA — shared contract for all module authors

A one-tap web game. The player is a small satellite orbiting a planet. Tap (or Space) to
detach: the satellite flies in a straight line along the orbit's tangent. If it enters the
capture zone of another planet it starts orbiting that planet. Goal: climb upward from planet
to planet as far as possible. Stars give bonus points, asteroids kill, power-ups help.
Losing: flying too long without capture, leaving the screen, or hitting an asteroid.

## Global rules (EVERY file must follow)

- Plain browser JavaScript (ES2017), **no ES modules, no import/export, no libraries, no build**.
- Every JS file is an IIFE that attaches exactly one object to the global namespace:
  ```js
  (function () {
    'use strict';
    var ORB = window.ORB = window.ORB || {};
    ORB.Something = { ... };
  })();
  ```
- **Do not touch the DOM, canvas, audio or localStorage at load time.** Only inside functions
  (init/show/draw/...). Modules may reference other modules (`ORB.CONFIG`, `ORB.M`, ...) only
  inside functions, never at load time.
- World coordinates: x to the right, **y downward** (canvas convention). Progress goes UP,
  i.e. toward more negative y. Units are "world px".
- Vectors are plain objects `{x, y}`. Times are in **seconds**, angles in **radians**.
- UI text always comes from `ORB.I18N.t(key)`.
- Wrap any `localStorage`, `navigator.vibrate`, `AudioContext` usage in try/catch.
- Keep code readable, short comments, 2-space indentation.

## File list and load order (index.html includes them in exactly this order)

```
js/config.js js/math.js js/storage.js js/i18n.js js/view.js js/input.js js/audio.js
js/haptics.js js/camera.js js/difficulty.js js/planets.js js/stars.js js/asteroids.js
js/powerups.js js/player.js js/score.js js/particles.js js/skins.js js/background.js
js/render-planets.js js/render-entities.js js/render-player.js js/hud.js js/screens.js
js/tutorial.js js/game.js
```

## Data shapes

```js
Planet = { id, x, y, baseX, radius, orbitRadius, hue /*0..360*/, angularSpeed /*rad/s*/,
           moveAmp /*px, 0 = static*/, moveSpeed /*rad/s*/, movePhase, visited /*bool*/,
           ringed /*bool, decorative*/ }
Player = { x, y, vx, vy, state /*'orbit'|'fly'|'dead'*/, planet /*Planet|null*/,
           fromPlanet /*Planet|null, the planet it launched from*/, angle, dir /*1|-1*/,
           orbitDist, flyTime, trail /*[{x,y}] newest last*/, shield /*bool*/,
           magnetTime /*s left*/, slowTime /*s left*/ }
Star     = { x, y, r, phase, collected /*bool*/ }
Asteroid = { x, y, vx, vy, r, rot, rotSpeed, verts /*array of 9..12 radius multipliers 0.7..1.2*/ }
Powerup  = { x, y, r, kind /*'shield'|'magnet'|'slow'*/, phase, collected /*bool*/ }
Difficulty = { angularSpeed, gapMin, gapMax, radiusMin, radiusMax, moveChance, moveAmpMin,
               moveAmpMax, asteroidRate /*spawns per second*/, starChance, powerChance }
```

## Module APIs

### js/config.js — `ORB.CONFIG` (plain object, exactly these keys at least)
```
WORLD_W: 420, MIN_VIEW_H: 640, MAX_DPR: 2,
LAUNCH_SPEED: 520, MAX_FLY_TIME: 3.2, OFFSCREEN_MARGIN: 40,
CAPTURE_PAD: 8, ORBIT_GAP: 26, PLAYER_RADIUS: 7, TRAIL_LEN: 26,
CAMERA_LERP: 4, CAMERA_LEAD: 0.2,
PERFECT_TIME: 0.75, MAX_COMBO: 5, PLANET_POINTS: 10, STAR_POINTS: 5,
MAGNET_TIME: 8, MAGNET_RADIUS: 150, SLOW_TIME: 5, SLOW_FACTOR: 0.55,
DEATH_DELAY: 1.0,
COLORS: { bg1: '#05010f', bg2: '#140a33', accent: '#7df9ff', accent2: '#ff5fd2',
          star: '#ffd86b', danger: '#ff5a5a', text: '#eef2ff' }
```

### js/math.js — `ORB.M`
`clamp(v,a,b)`, `lerp(a,b,t)`, `dist(ax,ay,bx,by)`, `dist2(ax,ay,bx,by)`, `rand(a,b)` (float),
`randInt(a,b)` (inclusive), `pick(arr)`, `chance(p)` (bool), `angle(ax,ay,bx,by)` (atan2 from a to b),
`wrapAngle(a)` (to -PI..PI), `easeOutCubic(t)`, `hsl(h,s,l,a)` → css string `hsla(...)`
(a defaults to 1), `circleHit(ax,ay,ar,bx,by,br)` → bool.

### js/storage.js — `ORB.Storage`
`get(key, def)` (JSON parse, returns def on any failure), `set(key, value)` (JSON stringify),
`getBest()` → number (default 0), `setBest(n)`. Key prefix `'orbita.'`. Must never throw.

### js/i18n.js — `ORB.I18N`
`lang` ('ru' if `navigator.language` starts with 'ru', else 'en'; detect lazily in `t`),
`t(key, vars)` — returns string, replaces `{name}` with `vars.name`. Unknown key → key itself.
Keys (provide ru and en): `title` (ОРБИТА / ORBITA), `subtitle` (Прыгай с орбиты на орбиту /
Hop from orbit to orbit), `play`, `resume`, `restart`, `menu`, `paused`, `gameOver`
(Орбита потеряна / Orbit lost), `score`, `best`, `newBest`, `tapHint` (Тапни или нажми пробел,
чтобы сорваться с орбиты / Tap or press Space to break orbit), `soundOn`, `soundOff`, `skins`,
`locked` (С {n} очков / At {n} pts), `perfect` (Идеально! / Perfect!), `shield`, `magnet`, `slow`,
`lostTime` (Слишком долго в пустоте / Lost in the void), `lostScreen` (Улетел за край / Flew off),
`lostAsteroid` (Астероид! / Asteroid!), `planets` (Планет / Planets).

### js/view.js — `ORB.View`
Fields: `cssW, cssH, dpr, scale, w, h` (w/h = visible WORLD size).
`init(canvas)`: stores canvas, listens to `resize` + `orientationchange` + `visualViewport resize`,
calls `resize()`. `resize()`: cssW/cssH = size of `canvas.parentElement` (clientWidth/Height),
`dpr = min(devicePixelRatio||1, CONFIG.MAX_DPR)`, sets `canvas.width = round(cssW*dpr)` etc. and
canvas.style width/height in px, `scale = min(cssW / CONFIG.WORLD_W, cssH / CONFIG.MIN_VIEW_H)`,
`w = cssW/scale`, `h = cssH/scale`, then calls all callbacks. `onResize(cb)` registers callback.
`worldTransform(ctx, camX, camY)`: `ctx.setTransform(dpr*scale,0,0,dpr*scale, dpr*(cssW/2 - camX*scale), dpr*(cssH/2 - camY*scale))`.
`screenTransform(ctx)`: `ctx.setTransform(dpr,0,0,dpr,0,0)`.

### js/input.js — `ORB.Input`
`init(canvas)`: `pointerdown` on canvas → `preventDefault()` + fire tap callbacks.
`keydown` on window: Space, Enter, ArrowUp, KeyW → tap (preventDefault for Space/ArrowUp; ignore
`e.repeat`; ignore if `document.activeElement` is a BUTTON so buttons still work with Enter/Space);
Escape, KeyP → pause callbacks. Also on canvas: `touchstart`/`touchmove` preventDefault
(passive:false), `contextmenu` preventDefault.
`onTap(cb)`, `onPause(cb)` register callbacks. Every user gesture (pointerdown anywhere on
document, keydown) also calls `ORB.Audio && ORB.Audio.unlock()`.

### js/audio.js — `ORB.Audio`
Synthesized with WebAudio (oscillators + gain envelopes, a little noise for death). No files.
`unlock()` (create/resume AudioContext lazily, safe to call often), `play(name)` where name ∈
`'launch','capture','perfect','star','power','shield','death','click'`. `setMuted(b)` (persist via
`ORB.Storage.set('muted', b)`), `isMuted()` (reads storage on first call), `toggle()` → returns new
muted bool. Master volume ~0.35. Silent no-op if WebAudio unavailable.

### js/haptics.js — `ORB.Haptics`
`buzz(pattern)` → `navigator.vibrate(pattern)` if supported and enabled and not muted-by-user.
`setEnabled(b)`, `isEnabled()` (persist key 'haptics', default true).

### js/camera.js — `ORB.Camera`
Fields `x, y, shakeT, shakeMag`. `reset(x, y)`. `update(dt, targetY)`:
`y += (targetY - y) * min(1, CONFIG.CAMERA_LERP*dt)`, `x` stays `CONFIG.WORLD_W/2`, shake decays.
`shake(mag, dur)`. `getX()` / `getY()` → x/y plus random shake offset (when shakeT > 0).

### js/difficulty.js — `ORB.Difficulty`
`get(planets)` → Difficulty object (planets = number of planets visited so far). Ramps smoothly:
angularSpeed 1.7 → 3.2 (by ~60 planets); gapMin 150 → 200, gapMax 220 → 300; radiusMin 18,
radiusMax 34 → 24; moveChance 0 until 8 planets, then up to 0.6; moveAmpMin 25, moveAmpMax 30 → 90;
asteroidRate 0 until 4 planets, then 0.15 → 0.9; starChance 0.75; powerChance 0.14.

### js/planets.js — `ORB.Planets`
`list` (array, ordered by creation = going upward). `reset()`: clears, creates the first planet at
`(CONFIG.WORLD_W/2, 0)`, radius 30, static, `visited: true`, angularSpeed 1.7.
`ensure(topY, diff)`: while the highest planet's y > topY, create the next planet above it:
`y = prev.y - rand(diff.gapMin, diff.gapMax)`; radius `rand(diff.radiusMin, diff.radiusMax)`;
`orbitRadius = radius + CONFIG.ORBIT_GAP`; x random in `[orbitRadius+12, WORLD_W-orbitRadius-12]`
but retry (up to 10x) so that center distance to prev ≥ `prev.orbitRadius + orbitRadius + 50`
and horizontal offset from prev ≥ 40; with `diff.moveChance` the planet moves:
`moveAmp = rand(moveAmpMin, moveAmpMax)` clamped so the orbit stays inside the world width,
moveSpeed `rand(0.6, 1.4)`. angularSpeed = `diff.angularSpeed * rand(0.9, 1.1)`, hue random,
`ringed = chance(0.3)`, `visited: false`, increasing id. **Returns array of newly created planets.**
`update(dt)`: for moving planets `movePhase += moveSpeed*dt; x = baseX + sin(movePhase)*moveAmp`.
`prune(bottomY)`: remove planets with `y - orbitRadius > bottomY`.
`findCapture(x, y, exclude)` → first planet (≠ exclude) with `dist(x,y,p) < p.orbitRadius + CONFIG.CAPTURE_PAD`, else null.
`highest()` → last planet.

### js/stars.js — `ORB.Stars`
`list`, `reset()`, `spawnBetween(a, b, diff)`: with `diff.starChance` place 1–3 stars (r = 9) on
the segment between planets a and b (at t = 0.35..0.65, with small random sideways jitter ±30),
never inside any planet orbitRadius. `update(dt, player)`: animate phase; if `player.magnetTime > 0`
stars within `CONFIG.MAGNET_RADIUS` move toward the player (speed ~420); mark collected when
`circleHit` with player (PLAYER_RADIUS + r); remove collected; **returns count collected this
frame**. `prune(bottomY)`.

### js/asteroids.js — `ORB.Asteroids`
`list`, `reset()`, `maybeSpawn(dt, camY, viewW, viewH, diff)`: with probability
`diff.asteroidRate*dt` spawn one just outside the left or right edge of the visible area
(`x = WORLD_W/2 ± (viewW/2 + 40)`), `y` in `[camY - viewH*0.45, camY + viewH*0.15]`, moving
inward with `|vx| = rand(50,120)`, `vy = rand(-20,20)`, `r = rand(10,20)`, random rot/rotSpeed/verts.
Max 6 alive. `update(dt, player)`: move/rotate; remove when far outside (`|x - WORLD_W/2| > viewW`
— store last viewW from maybeSpawn); **returns the asteroid hitting the player** (circleHit with
PLAYER_RADIUS, using r*0.85) **or null**. `destroy(a)` removes it. `prune(bottomY)`.

### js/powerups.js — `ORB.Powerups`
`list`, `reset()`, `maybeSpawnBetween(a, b, diff)`: with `diff.powerChance` place one power-up
(r = 12, random kind) near the midpoint between a and b (jitter ±40), not inside orbits.
`update(dt, player)`: animate, magnet also attracts power-ups, collect on circleHit, remove
collected, **returns array of kinds collected this frame** (usually empty). `prune(bottomY)`.

### js/player.js — `ORB.Player`
`create(planet)` → Player orbiting `planet`, angle = PI/2 (bottom of the planet... use -PI/2? use
`Math.PI * 0.5`), dir = 1, orbitDist = planet.orbitRadius, trail [], everything else zero/false.
`update(p, dt)`: if `'orbit'`: `p.angle += p.dir * p.planet.angularSpeed * dt`;
`p.orbitDist` lerps toward `p.planet.orbitRadius` (rate 8/s); `p.x = planet.x + cos(angle)*orbitDist`,
same for y; velocity vx/vy = tangential velocity (for rendering). If `'fly'`: `x += vx*dt`,
`y += vy*dt`, `flyTime += dt`. Always push `{x,y}` to trail (cap `CONFIG.TRAIL_LEN`).
`launch(p)`: only from orbit. Tangent dir = `(-sin(angle), cos(angle)) * p.dir`;
`vx, vy = tangent * CONFIG.LAUNCH_SPEED`; `fromPlanet = planet; planet = null; state = 'fly';
flyTime = 0`.
`capture(p, planet)`: `angle = atan2(p.y - planet.y, p.x - planet.x)`; `orbitDist = dist`;
dir = sign of cross product `(rx*vy - ry*vx)` where r = player - planet (≥0 → 1, else -1);
`state = 'orbit'; planet = planet; vx = vy = 0`.
`tangent(p)` → `{x, y}` unit tangent of the current orbit (for aim guide).

### js/score.js — `ORB.Score`
Fields `value, combo, planets, stars`. `reset()` (combo = 1). `addPlanet(flyTime)` → if
`flyTime < CONFIG.PERFECT_TIME` combo = min(combo+1, MAX_COMBO) else combo = 1;
`planets++`; points = PLANET_POINTS * combo; returns `{ points, combo, perfect: flyTime < PERFECT_TIME }`.
`addStar()` → points = STAR_POINTS * combo; `stars++`; returns points. `value` accumulates.

### js/particles.js — `ORB.Particles`
`reset()`, `burst(x, y, color, count=16, speed=160, life=0.6)` (random directions, slight
drag, size 1.5–3.5), `ring(x, y, color, radius)` (an expanding fading circle, life 0.5),
`update(dt)`, `draw(ctx)` (world coords, globalCompositeOperation 'lighter', restore after).
Cap 500 particles.

### js/skins.js — `ORB.Skins`
`list` = 6 skins `{ id, name: {ru, en}, color, trail, unlock }` with unlock scores
0, 60, 150, 300, 600, 1000 (e.g. Комета/Comet cyan, Роза/Rose pink, Солнце/Sun gold,
Мята/Mint green, Аметист/Amethyst violet, Призрак/Ghost white). `isUnlocked(skin, best)`,
`currentId()` (storage key 'skin', default first), `current()` → skin object (fallback first if
locked/unknown), `select(id)` → bool (only if unlocked by `ORB.Storage.getBest()`), `name(skin)`
→ localized name via `ORB.I18N.lang`.

### js/background.js — `ORB.Background`
`init()` creates 3 parallax layers of ~60/40/25 random stars (normalized positions, sizes, twinkle
phases). `draw(ctx, camY, time)`: caller already set `ORB.View.screenTransform(ctx)`. Fill whole
`View.cssW x View.cssH` with vertical gradient COLORS.bg1 → bg2, a couple of soft nebula radial
gradients (hue slowly shifting with camY), then star layers scrolled by `camY * factor` (0.05,
0.15, 0.3) and wrapped vertically, twinkling. Must look good at any aspect ratio.

### js/render-planets.js — `ORB.RenderPlanets`
`draw(ctx, planets, time, currentPlanet)` in world coords. For each planet: faint dashed orbit
circle (orbitRadius; brighter and solid-ish if `currentPlanet`), soft outer glow, body filled with
a radial gradient from `M.hsl(hue,…)`, a few darker crater/band details (deterministic from id),
optional ring (ellipse) if `ringed`, a small check/glow marker if `visited`.

### js/render-entities.js — `ORB.RenderEntities`
`draw(ctx, stars, asteroids, powerups, time)` in world coords. Stars: glowing 5-point gold stars,
pulsing/rotating. Asteroids: grey-brown jagged polygons from `verts`, rotated by `rot`, red-ish
warning glow. Power-ups: glowing circles with an icon drawn with canvas paths (no emoji):
shield = blue hexagon/arc, magnet = red U shape, slow = green hourglass/clock.

### js/render-player.js — `ORB.RenderPlayer`
`draw(ctx, player, time)` in world coords. Uses `ORB.Skins.current()` for colors. Draws the trail
(fading line with 'lighter'), the satellite (small glowing body with two little solar panels,
rotated along velocity/tangent), shield bubble if `player.shield`, magnet aura if magnetTime > 0.
If `state === 'orbit'`: an aim guide — dashed line from player along `ORB.Player.tangent(player)`,
length 110, fading out. Nothing if `state === 'dead'`.

### js/hud.js — `ORB.HUD`
Builds its DOM inside `#hud` on `init({ onPause })`:
```html
<div class="hud-top">
  <div class="hud-score"><span class="hud-score-value">0</span><span class="hud-combo hidden">x2</span></div>
  <button class="icon-btn hud-pause" aria-label="Pause"><!-- inline SVG two bars --></button>
</div>
<div class="hud-powerups">
  <span class="pu pu-shield hidden"></span><span class="pu pu-magnet hidden"></span><span class="pu pu-slow hidden"></span>
</div>
<div class="hud-flash"></div>
```
API: `show()` / `hide()` (toggle class `hidden` on #hud), `setScore(n)` (+ brief CSS class `bump`),
`setCombo(n)` (hidden when n ≤ 1, text `x{n}`), `setPowerups({shield, magnet, slow})` (shield bool;
magnet/slow seconds left → show `I18N name + ceil(sec)`), `flash(text, color)` (sets text, re-adds
class `show`, auto-remove after 900ms).

### js/screens.js — `ORB.Screens`
`init(handlers)` where handlers = `{ onPlay, onResume, onRestart, onMenu, onToggleSound }`
(onToggleSound returns new muted bool). Builds three `<section class="screen screen-NAME">`
inside `#screens`, each with a `<div class="screen-card">`:
- menu: `h1.game-title` (t('title')), `p.subtitle`, `p.stat` best score, `button.btn.btn-primary`
  Play, `h2.section-title` Skins, `div.skins` with `button.skin` per skin (`span.skin-dot`
  background = skin.color, `span.skin-name`, locked → class `locked` + text t('locked',{n})),
  selected → class `selected`; clicking an unlocked skin calls `ORB.Skins.select` and re-renders;
  `button.btn.btn-ghost.sound-btn` sound toggle.
- pause: `h2.screen-title` Paused, Resume (primary), Restart, Menu, sound toggle.
- over: `h2.screen-title` Game Over, `p.reason`, `div.big-score`, `p.stat` best, `span.badge.new-best`
  (hidden unless new best), `p.stat` planets count, Restart (primary), Menu.
`show(name, data)` — data for menu `{best}`, for over `{score, best, newBest, planets, reason}`
(reason = i18n key). Re-renders dynamic text, adds class `active` to that section only, adds class
`has-active` to `#screens`, focuses the primary button. All buttons call `ORB.Audio.play('click')`.
`hideAll()` removes `active` and `has-active`. `current()` → name or null.

### js/tutorial.js — `ORB.Tutorial`
Uses `#tutorial`. `shouldShow()` → `!ORB.Storage.get('tutorialDone', false)`. `show()` builds
(once) `<div class="tutorial-hint"><div class="tap-icon"></div><p>t('tapHint')</p></div>` and adds
class `show`. `hide()` removes `show`. `done()` → hide + store `tutorialDone = true`.

### js/game.js — `ORB.Game` (main loop + state machine, boots itself)
States: `'menu' | 'play' | 'pause' | 'dying' | 'over'`.
- On `DOMContentLoaded` (or immediately if already loaded) call `ORB.Game.init()`.
- `init()`: canvas `#game`, `View.init`, `Input.init`, `HUD.init({onPause: pause})`,
  `Screens.init({...})`, `Background.init()`, `Input.onTap(onTap)`, `Input.onPause(togglePause)`,
  `document visibilitychange` hidden → pause when playing. `setupWorld()`, state `'menu'`,
  `Screens.show('menu', {best})`, start `requestAnimationFrame` loop (dt clamped to 0.033).
- `setupWorld()`: reset Planets, Stars, Asteroids, Powerups, Particles, Score; player =
  `Player.create(Planets.list[0])`; `Camera.reset(WORLD_W/2, player.planet.y - View.h*CAMERA_LEAD)`;
  generate ahead with `ensureAhead()`.
- `ensureAhead()`: `created = Planets.ensure(Camera.y - View.h * 1.2, Difficulty.get(Score.planets))`;
  for each created planet with its previous planet: `Stars.spawnBetween(prev, p, diff)`,
  `Powerups.maybeSpawnBetween(prev, p, diff)`.
- `start()`: setupWorld, state play, Screens.hideAll, HUD.show, HUD score/combo reset,
  Tutorial.show if shouldShow.
- Tap in play with player orbiting → `Player.launch`, Audio 'launch', Haptics 8, small particle
  burst, `Tutorial.done()` if visible.
- Update in play: `sdt = dt * (player.slowTime > 0 ? SLOW_FACTOR : 1)`; timers decrease with real dt.
  Planets.update(sdt), Player.update(player, sdt). In fly: `Planets.findCapture(x, y, fromPlanet)` →
  capture; if planet not visited: mark visited, `Score.addPlanet(flyTime)`, HUD updates, Audio
  'capture' or 'perfect', `Particles.ring`, flash `t('perfect') + ' x' + combo` when perfect.
  Death checks while flying: `flyTime > MAX_FLY_TIME` → 'lostTime'; `|x - Camera.x| > min(View.w/2,
  WORLD_W*0.8) + OFFSCREEN_MARGIN` or `y > Camera.y + View.h/2 + OFFSCREEN_MARGIN` → 'lostScreen'.
  Stars.update → Score.addStar per star, Audio 'star'. Powerups.update → apply (shield = true,
  magnetTime = MAGNET_TIME, slowTime = SLOW_TIME), Audio 'power', HUD.flash name.
  `Asteroids.maybeSpawn(sdt, Camera.y, View.w, View.h, diff)`; `Asteroids.update(sdt, player)` hit →
  if shield: shield=false, destroy asteroid, burst, Audio 'shield'; else die('lostAsteroid').
  Camera target: `(orbit ? planet.y : player.y) - View.h*CAMERA_LEAD`. ensureAhead; prune all with
  `bottomY = Camera.y + View.h`. HUD.setPowerups each frame.
- `die(reason)`: state 'dying', player.state 'dead', big burst, Camera.shake(10, 0.4), Audio 'death',
  Haptics [30,40,60]; after `DEATH_DELAY` s: best update via Storage, HUD.hide,
  `Screens.show('over', {...})`, state 'over'.
- Menu/over states: still animate world (Planets.update, Player.update while orbiting), camera.
- Render each frame: `View.screenTransform(ctx)`; clear; `Background.draw(ctx, Camera.y, time)`;
  `View.worldTransform(ctx, Camera.getX(), Camera.getY())`; RenderPlanets, RenderEntities,
  Particles.draw, RenderPlayer.
- `pause()` / `resume()` / `togglePause()` / `toMenu()` (setupWorld, show menu with best, HUD.hide).

## DOM skeleton (index.html) and CSS class contract

```html
<div id="app">
  <canvas id="game"></canvas>
  <div id="hud" class="hud hidden"></div>
  <div id="screens"></div>
  <div id="tutorial"></div>
</div>
```
CSS must: make `#app` fill the viewport (`position:fixed; inset:0; height:100dvh` fallback 100vh),
canvas absolutely fills `#app` (display:block); `.hidden{display:none!important}`; `touch-action:none`,
no text selection, no tap highlight, no overscroll; respect `env(safe-area-inset-*)`.
`#hud` overlays with `pointer-events:none` except its buttons; `#screens` overlays and has
`pointer-events:none` unless `.has-active`; `.screen` hidden unless `.active` (fade/scale-in);
`#tutorial` pointer-events none. Style every class named above (hud-*, pu, pu-*, icon-btn, bump,
hud-flash.show, screen-card, game-title, subtitle, stat, btn, btn-primary, btn-ghost, sound-btn,
section-title, skins, skin, skin-dot, skin-name, skin.locked, skin.selected, screen-title, reason,
big-score, badge, new-best, tutorial-hint(.show), tap-icon (pulsing ring animation)).
Dark-space neon look (accent #7df9ff, accent2 #ff5fd2, text #eef2ff), glassy cards
(backdrop-filter), system-ui font, buttons ≥ 48px tall, fluid type with `clamp()`, works from
320px phones to 4K desktops, portrait and landscape (short landscape: compact card, scrollable).
