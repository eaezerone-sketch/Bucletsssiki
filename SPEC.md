# ORBITA v2 — shared contract for all module authors

ORBITA is a one-tap browser game. v1 works (see `SPEC-v1.md` and the current `js/*.js`), but it
feels flat: orbits are rigid circles, flight is a straight line, planets are static pictures.
**v2 makes it physical and alive:** inertia, gravity that bends the flight path, an elastic
"tether" that latches the ship onto a planet when it passes close and stretches/springs like a
rubber band before settling into orbit, animated planets that rotate, wobble on impact and have
moons, new planet types, black holes, comets, wormholes, a rising "void" that chases the player,
achievements, music, juicy effects.

The core loop stays: you orbit a planet → tap → you fly off with your current momentum (+ a
boost) → gravity bends your path → if you pass close to another planet you latch on → climb up.

## Global rules (EVERY file must follow)

- Plain browser JavaScript (ES2017), **no ES modules, no import/export, no libraries, no build**.
- Every JS file is an IIFE that attaches exactly one object to `window.ORB`:
  ```js
  (function () {
    'use strict';
    var ORB = window.ORB = window.ORB || {};
    ORB.Something = { ... };
  })();
  ```
- **Never touch the DOM, canvas, audio or localStorage at load time**, and never read other
  modules at load time — only inside functions.
- World coords: x right, **y down**; progress goes UP (more negative y). Units: world px.
  Times in **seconds**, angles in **radians**. Vectors are `{x, y}` objects.
- UI text always via `ORB.I18N.t(key)`. Wrap localStorage / vibrate / AudioContext in try/catch.
- **Performance matters (phones):** no per-frame allocation of big arrays, cache gradients or
  offscreen canvases where possible, cull objects that are off-screen, keep draw calls modest.
  Target 60 fps on a mid-range phone with ~10 planets on screen.
- Every draw function must `ctx.save()` / `ctx.restore()` and leave `globalAlpha`,
  `globalCompositeOperation`, `setLineDash([])`, `shadowBlur` clean.
- If you rewrite an existing file, **read the current file first** and keep every v1 API that
  is still listed here working.
- Keep code readable: short comments, 2-space indentation, small functions.

## Load order (index.html includes exactly these, in this order)

```
js/config.js js/math.js js/storage.js js/i18n.js js/view.js js/input.js js/audio.js
js/music.js js/haptics.js js/timefx.js js/camera.js js/difficulty.js js/physics.js
js/planets.js js/void.js js/stars.js js/asteroids.js js/powerups.js js/comets.js
js/wormholes.js js/player.js js/score.js js/achievements.js js/particles.js js/fx.js
js/skins.js js/background.js js/render-orbits.js js/render-special.js js/render-planets.js
js/render-entities.js js/render-player.js js/hud.js js/screens.js js/tutorial.js js/game.js
```
Unchanged from v1 (do not edit unless your task says so): `math.js storage.js input.js
haptics.js skins.js`.

## Data shapes

```js
Planet = {
  id, type /* 'rocky'|'ice'|'gas'|'lava'|'jelly'|'star'|'crumble'|'blackhole' */,
  x, y, baseX, vx, vy /* current velocity of the planet itself, px/s */,
  radius, orbitRadius /* resting tether length */, latchRadius /* ship latches inside this */,
  gravityRadius /* gravity acts inside this */, mass /* gravity strength multiplier */,
  tetherK /* spring stiffness multiplier, 1 normal, 0.5 jelly */,
  hue, angularSpeed /* rad/s of a settled orbit */, spin /* surface rotation rad/s */, rot /* current surface rotation */,
  moveAmp, moveSpeed, movePhase,
  visited, ringed, ringTilt /* 0.25..0.45 ellipse ratio */,
  moons: [{ dist, angle, speed, r, hue }],
  wobble, wobbleV, wobbleAngle /* squash-and-stretch spring (wobble ≈ -0.3..0.3) */,
  ripple /* 0..1 orbit ring ripple amplitude, decays */, ripplePhase,
  seed /* integer for deterministic visuals */,
  heat /* star only: 0..1 overheat while orbiting */,
  crumble /* -1 = not crumbling, else 0..1 progress */, dead /* true once crumbled/eaten */,
  age /* seconds since created */
}
Player = {
  x, y, vx, vy, state /* 'orbit'|'fly'|'dead' */, planet /* Planet|null (orbit) */,
  fromPlanet /* last planet left */, ignorePlanet, ignoreT /* can't re-latch ignorePlanet while ignoreT>0 */,
  angle /* angle of ship around planet (rendering) */, dir /* 1|-1 */,
  latchT /* s since latch */, stretch /* (dist - orbitRadius)/orbitRadius, for rendering */,
  flyTime, boostT /* s left of engine flame after launch */, trail /* [{x,y}] newest last */,
  shield, magnetTime, slowTime, speed /* |v| cached each update */
}
Star = { x, y, r, phase, collected }
Asteroid = { x, y, vx, vy, r, rot, rotSpeed, verts }
Powerup = { x, y, r, kind /* 'shield'|'magnet'|'slow' */, phase, collected }
Comet = { x, y, vx, vy, r, tail /* [{x,y}] */, used /* bool, already ridden */ }
Wormhole = { x, y, r, isExit, pair /* the other Wormhole */, phase, cooldown, id }
Difficulty = {
  angularSpeed, gapMin, gapMax, radiusMin, radiusMax, moveChance, moveAmpMin, moveAmpMax,
  asteroidRate, starChance, powerChance,
  typeWeights /* {rocky, ice, gas, lava, jelly, star, crumble} relative weights */,
  blackholeChance, cometRate /* per s */, wormholeChance, voidSpeed /* px/s */
}
Stats (one run) = { score, planets, stars, height, slingshots, comets, wormholes,
                    perfectStreak /* best streak this run */, blackholePasses, maxSpeed }
```

## Module APIs

### js/config.js — `ORB.CONFIG` (REWRITE: keep all v1 keys, add these)
```
GRAVITY: 4.5e6,            // accel = GRAVITY * mass * falloff / max(d², (radius*1.3)²)
LATCH_PAD_MIN: 22, LATCH_PAD_FACTOR: 0.55,   // latchRadius = orbitRadius + max(MIN, orbitRadius*FACTOR)
GRAVITY_RADIUS_FACTOR: 2.8, // gravityRadius = orbitRadius * factor (blackhole: 230 fixed)
TETHER_K: 55, TETHER_DAMP: 4.5, TETHER_TANGENT: 2.2,
LAUNCH_BOOST: 300, LAUNCH_MIN_SPEED: 480, MAX_SPEED: 950,
IGNORE_FROM_TIME: 0.35, MAX_FLY_TIME: 4.5, PHYS_SUBSTEPS: 4,
STAR_HEAT_RATE: 0.32, CRUMBLE_TIME: 2.2, BLACKHOLE_KILL_FACTOR: 1.4,
SLINGSHOT_POINTS: 25, COMET_POINTS: 15, WORMHOLE_POINTS: 20, COMET_BOOST: 260,
VOID_START: 560,           // void starts this far below the first planet
ZOOM_MIN: 0.82, ZOOM_SPEED_LO: 520, ZOOM_SPEED_HI: 900,
TRAIL_LEN: 34
```
(v1 `LAUNCH_SPEED`, `CAPTURE_PAD` may stay but are unused.)

### js/view.js — `ORB.View` (EDIT)
Same as v1, plus `worldTransform(ctx, camX, camY, zoom)` — `zoom` (default 1) multiplies the
scale: `s = dpr*scale*zoom`, translate `dpr*cssW/2 - camX*s`, `dpr*cssH/2 - camY*s`.
`visibleW(zoom)` → `w/zoom`, `visibleH(zoom)` → `h/zoom`.

### js/timefx.js — `ORB.TimeFX` (NEW)
`reset()`, `hitstop(dur)` (game time freezes for dur, max 0.12), `slowmo(factor, dur)` (game time
× factor, smoothly easing back to 1 over the last 40% of dur), `update(realDt)` → returns scaled
game dt, `scale` (current factor, read-only).

### js/camera.js — `ORB.Camera` (REWRITE)
Fields `x, y, zoom, shakeT, shakeMag`. `reset(x, y)` (zoom 1). `update(dt, targetX, targetY, targetZoom)`:
y lerps with `CAMERA_LERP`, x lerps 2x slower, zoom lerps with rate 2. `shake(mag, dur)`.
`getX()`, `getY()` (with shake offset), `getZoom()`.

### js/physics.js — `ORB.Physics` (NEW, the heart of v2)
- `gravity(x, y, planets, ignore)` → `{ ax, ay, strongest /* Planet|null */, strength }`. For each
  planet (≠ ignore, not dead) with `d < gravityRadius`: falloff `f = smoothstep(1 - (d - radius)/(gravityRadius - radius))`
  (clamped 0..1), `a = GRAVITY * mass * f / max(d², (radius*1.3)²)` toward the planet. Sum all.
  `strongest` = planet giving the biggest a.
- `stepFree(p, dt, planets, ignore)`: free flight with `PHYS_SUBSTEPS` semi-implicit Euler
  substeps (v += a*h; x += v*h), clamp |v| ≤ MAX_SPEED. Updates p.x, p.y, p.vx, p.vy, p.speed.
- `stepTether(p, dt, planet)`: spring orbit in the planet's moving frame, substepped. With
  `rx,ry = p - planet`, `d = |r|`, `n = r/d`, `t = (-n.y, n.x) * p.dir`,
  `rvx,rvy = v - planet.v`, `vr = rv·n`, `vt = rv·t`, `R = planet.orbitRadius`,
  `vTarget = planet.angularSpeed * R`:
  `a = -TETHER_K*planet.tetherK*(d - R)*n - TETHER_DAMP*vr*n - (vt*vt/d)*n + TETHER_TANGENT*(vTarget - vt)*t`,
  then `v += a*h` (with the planet's own velocity added back: integrate relative velocity, then
  `v = rv + planet.v`), `x += v*h`. Effect: an incoming ship latches at a distance > R, the
  tether stretches, springs it in with an underdamped wobble, and its fast incoming spin slowly
  eases to the planet's orbit speed — this is the "inertia" feel. Sets `p.angle = atan2(ry, rx)`,
  `p.stretch = (d - R)/R`, `p.speed`.
- `launchVelocity(p)` → `{vx, vy}`: current velocity + `LAUNCH_BOOST` along the tangent `t`;
  if the resulting speed < LAUNCH_MIN_SPEED scale it up to that.
- `predict(x, y, vx, vy, planets, ignore, maxTime /*1.3*/, step /*1/30*/)` → `{ points: [{x,y}], hit: Planet|null }`
  — simulates free flight (same gravity) and stops at the first latchable planet whose
  latchRadius it enters (`hit`), or at maxTime, or on a blackhole kill radius. Reuse one
  internal points array (don't allocate per call; return the same object).

### js/planets.js — `ORB.Planets` (REWRITE)
`list`, `reset()` (first planet: type 'rocky', `(WORLD_W/2, 0)`, radius 30, static, visited,
angularSpeed 1.7, a moon), `ensure(topY, diff)` → array of new planets (same chain logic as v1:
next planet above the previous with gap; x chosen so neighbours' latchRadius zones don't overlap
— center distance ≥ prev.latchRadius + latchRadius + 20 — and horizontal offset ≥ 40).
Chain planets pick a type from `diff.typeWeights`; never two `star` or two `crumble` in a row.
With `diff.blackholeChance` (only if no blackhole among the last 3 created) **also** add a
blackhole in the gap between prev and the new planet, pushed toward the side with more room
(x within 50..WORLD_W-50, ≥ 90 px horizontally from both chain planets); blackholes are pushed
to `list` in y order too and are returned in the created array (callers skip them for
stars/power-ups by checking `type`).
Type table (applied on top of the generic radius/orbit computation):
| type | radius | mass | angularSpeed× | tetherK | notes |
|---|---|---|---|---|---|
| rocky | r | 1.0 | 1 | 1 | 0–2 moons |
| ice | r*0.9 | 0.8 | 1.35 | 1 | slippery fast orbit |
| gas | r*1.25 | 1.7 | 0.8 | 1 | ringed 70%, 0–3 moons |
| lava | r | 1.1 | 1.05 | 1 | |
| jelly | r | 1.0 | 1 | 0.5 | wobbles a lot |
| star | r*1.15 | 1.4 | 1 | 1 | heat rises while orbiting it |
| crumble | r*0.85 | 0.9 | 1 | 1 | starts crumbling on latch |
| blackhole | 14–18 | 3.2 | – | – | no latch; gravityRadius 230; kill radius = radius*BLACKHOLE_KILL_FACTOR |

`orbitRadius = radius + ORBIT_GAP`, `latchRadius` and `gravityRadius` per CONFIG. Moons:
`dist = radius + 10..22`, `r = 2..4.5`, `speed ±0.6..1.6`. `spin = ±(0.15..0.5)`. `seed` random int.
`heat = 0`, `crumble = -1`, `dead = false`, `wobble = wobbleV = 0`, `ripple = 0`.
- `update(dt)`: movement (store `vx = (x - oldX)/dt`, vy 0), `rot += spin*dt`, moons advance,
  wobble spring `wobbleV += (-180*wobble - 9*wobbleV)*dt; wobble += wobbleV*dt` (jelly: k 90,
  damp 4), `ripple *= exp(-1.6*dt)`, `ripplePhase += 7*dt`, `age += dt`, crumble progress
  `crumble += dt/CRUMBLE_TIME` when ≥ 0, at ≥ 1 → `dead = true`.
- `impact(p, strength /*0..1*/, angle)`: `wobbleV += 2.4*strength` (jelly ×2), `wobbleAngle = angle`,
  `ripple = max(ripple, strength)`.
- `startCrumble(p)`: if `crumble < 0` set 0.
- `findLatch(x, y, ignore)` → first planet (≠ ignore, not dead, not blackhole) with
  `dist < latchRadius`, else null.
- `blackholeKill(x, y)` → blackhole planet whose kill radius contains (x, y), else null.
- `prune(bottomY)` (remove `y - gravityRadius > bottomY` and dead planets older than 1 s after
  death), `highest()` (last non-blackhole planet), `consume(voidY)` → marks planets with
  `y - radius > voidY` as dead (eaten by the void).

### js/player.js — `ORB.Player` (REWRITE)
- `create(planet)` → Player in `'orbit'` at angle PI/2, distance orbitRadius, velocity =
  tangential `planet.angularSpeed*orbitRadius` (dir 1), trail [], timers 0.
- `update(p, dt)`: orbit → `Physics.stepTether(p, dt, p.planet)`, `latchT += dt`;
  fly → `Physics.stepFree(p, dt, ORB.Planets.list, null)`, `flyTime += dt`, `ignoreT -= dt`;
  `boostT -= dt`; trail push (cap TRAIL_LEN).
- `launch(p)`: only from orbit: `v = Physics.launchVelocity(p)`, `fromPlanet = ignorePlanet = planet`,
  `ignoreT = IGNORE_FROM_TIME`, `planet = null`, `state = 'fly'`, `flyTime = 0`, `boostT = 0.35`.
- `latch(p, planet)` → returns impact strength 0..1: `rv = v - planet.v`, `n` = unit from planet
  to ship, `dir = sign(cross(r, rv))` (≥0 → 1), `state = 'orbit'`, `planet = planet`, `latchT = 0`,
  strength = `clamp((|rv·n| + 0.3*|rv|) / 700, 0, 1)`.
- `release(p)`: orbit → fly keeping current velocity (used when a planet crumbles), ignore it.
- `canLatch(p, planet)` → `planet !== p.ignorePlanet || p.ignoreT <= 0`.
- `tangent(p)` → unit tangent `{x, y}`.

### js/void.js — `ORB.Void` (NEW) — the rising darkness
`y` (world y of the void's surface), `reset(startY)`, `update(dt, playerY, viewH, diff)`:
`speed = diff.voidSpeed`, and if `y - playerY > viewH*0.85` move 3× faster (rubber band so it
always stays a threat), never moves down. `distance(y)` → `this.y - y`. `draw(ctx, time, camX, viewW, viewH)`
in world coords: a glowing wavy surface (several sine layers, deep red/violet `#ff2d55` →
`#2a0033`), filled darkness below it down to `y + viewH`, rising ember particles and dark
tendrils reaching up, drawn efficiently (one path per layer). Must look menacing and alive.

### js/difficulty.js — `ORB.Difficulty` (REWRITE, keep v1 fields)
Add: `typeWeights` — at 0 planets `{rocky:5, ice:0, gas:1, lava:0, jelly:0, star:0, crumble:0}`;
ice from 3, jelly from 4, lava from 2, star from 6, crumble from 8, growing to roughly
`{rocky:3, ice:2, gas:2, lava:2, jelly:2, star:1.5, crumble:1.5}` by 40 planets;
`blackholeChance` 0 until 10 → 0.28 by 50; `cometRate` 0 until 5 → 0.06..0.2 /s;
`wormholeChance` 0 until 6 → 0.1..0.16; `voidSpeed` 16 → 78 px/s by 70 planets.
Keep the first ~5 planets easy (gaps on the small side, slow spin).

### js/stars.js (EDIT)
Same API. Stars are now placed along a **curved arc** between a and b (bulge sideways ±40 px, so
the player is rewarded for using gravity) and gently bob (`y` offset by sin(phase) * 3 in update,
store base pos). Never inside any planet's latchRadius.

### js/asteroids.js (EDIT)
Same API. Asteroids are bent by planet gravity at 35% strength (use `ORB.Physics.gravity`), get
destroyed (removed, return nothing) when they hit a planet body or a blackhole, and add
`nearMiss(player)` → returns asteroids that passed within `r + 22` of the player this frame
without hitting (each asteroid counts once; flag `missed`).

### js/powerups.js (EDIT)
Same API; never inside any latchRadius; bob like stars.

### js/comets.js — `ORB.Comets` (NEW)
`list`, `reset()`, `maybeSpawn(dt, camY, viewW, viewH, diff)` — with `diff.cometRate*dt` spawn a
comet entering from a top corner moving diagonally down-across (speed 260–380), r 7, max 2.
`update(dt, player)` → returns the comet the flying player touches (`circleHit` with r+10) that
is not `used` (mark used), else null; tail = last 18 positions. `prune(bottomY, viewW)`.

### js/wormholes.js — `ORB.Wormholes` (NEW)
`list` (both ends), `reset()`, `maybeSpawnBetween(a, b, diff)` — with `diff.wormholeChance` put an
entry near the side of the gap between a and b (outside every latchRadius) and its exit ~0.6 of
the next gap above b (at `b.y - rand(160, 220)`, x mirrored side), both r 18, linked via `pair`.
`update(dt, player)` → if the flying player enters an entry (dist < r) with cooldown ≤ 0:
teleport player to the exit (keep velocity, add 80 px/s upward), set cooldown 1 s on both,
return `{ from, to }`; else null. Animate `phase`. `prune(bottomY)` removes pairs whose exit is below.

### js/player.js trail / score — see above. js/score.js — `ORB.Score` (REWRITE)
Fields `value, combo, planets, stars, height, slingshots, comets, wormholes, perfectStreak,
streak, blackholePasses, maxSpeed`. `reset()`. `addPlanet(flyTime)` (as v1, also tracks streak /
perfectStreak), `addStar()`, `addBonus(kind /*'slingshot'|'comet'|'wormhole'|'nearMiss'*/)` →
points (`SLINGSHOT_POINTS`, `COMET_POINTS`, `WORMHOLE_POINTS`, nearMiss 10) × combo, increments
the matching counter, returns points. `setHeight(worldY)` → `height = max(height, round(-worldY/10))`.
`trackSpeed(s)`. `stats()` → Stats object.

### js/achievements.js — `ORB.Achievements` (NEW)
`list` of ~14 achievements `{ id, name:{ru,en}, desc:{ru,en}, test(stats) → bool }` (examples:
first slingshot, 10/25/50 planets, 500 m / 2000 m height, ride a comet, use a wormhole, 5 perfect
in a row, survive a black hole pass, 1000 points, collect 30 stars in one run, …).
`unlocked()` → array of ids (storage 'achievements'), `check(stats)` → array of newly unlocked
achievement objects (persists them), `name(a)`, `desc(a)` localized via `ORB.I18N.lang`,
`count()` → `{ got, total }`.

### js/particles.js — `ORB.Particles` (REWRITE, keep v1 API)
Keep `reset, burst(x,y,color,count,speed,life), ring(x,y,color,radius), update, draw`. Add
optional 7th arg `opts` to burst: `{ type: 'dot'|'spark'|'debris'|'smoke'|'ember', gravity, size, drag }`
(spark = short streak along velocity, debris = rotating little polygon, smoke = soft fading
expanding blob, ember = glowing dot drifting up). Add `debris(x, y, color, count)` shortcut and
`puff(x, y, color)` (one small smoke). Use a fixed-size pool (600), no per-frame allocation.

### js/fx.js — `ORB.FX` (NEW) — juice
`reset()`, `popup(x, y, text, color, size)` (world-space floating text: pops up with an
overshoot scale, drifts up, fades in 0.9 s; bold, outlined for readability), `shockwave(x, y, color, maxR)`
(world ring), `flash(color, alpha)` (screen), `setDanger(v 0..1)` (red pulsing vignette at
screen edges), `setSpeed(v 0..1)` (faint speed lines streaming at screen edges when > 0.55),
`update(dt)`, `drawWorld(ctx)` (world transform already set), `drawScreen(ctx)` (screen
transform set; uses `ORB.View.cssW/cssH`).

### js/audio.js — `ORB.Audio` (REWRITE, keep v1 API and sounds)
`play(name, param)`; add sounds: `'latch'` (elastic "twang" — pitch/volume rise with param
0..1), `'slingshot'` (whoosh + rising chime), `'comet'`, `'warp'` (phasey sweep), `'crumble'`
(rumble + crackle), `'burn'`, `'void'` (deep growl), `'achievement'` (pleasant fanfare),
`'nearMiss'`. Add `getContext()` → `{ ctx, master }` or null (unlocking lazily) so music can share it.

### js/music.js — `ORB.Music` (NEW)
Generative ambient soundtrack with WebAudio (no files): a soft evolving pad (2–3 detuned
oscillators through a lowpass) in a minor/dorian key, plus a sparse pentatonic arpeggio whose
density and filter brightness rise with intensity. `start()` (after Audio unlocked; uses
`ORB.Audio.getContext()`), `stop()` (fade out), `setIntensity(v 0..1)` (smooth),
`setMuted(b)`; respects `ORB.Audio.isMuted()`. Low CPU: schedule notes with a lookahead timer
(setInterval 100 ms), reuse nodes for the pad.

### js/background.js (REWRITE, same API `init()`, `draw(ctx, camY, time)`)
Keep parallax stars + nebulae; add: occasional shooting stars, 1–2 distant spiral galaxies,
slow dust motes, the nebula hue drifting with height (`camY`), a subtle vignette. Cache static
parts in offscreen canvases (rebuild on size change via `ORB.View.onResize`).

### js/render-orbits.js — `ORB.RenderOrbits` (NEW)
`draw(ctx, planets, time, player)` world coords, drawn before planet bodies. For each
latchable, non-dead planet: the orbit ring as a polyline (48 segments) with radius
`orbitRadius * (1 + 0.1*ripple*sin(5θ - ripplePhase))`; unvisited = bright dashed animated
(dashes flowing along the ring), visited = faint; the ring of `player.planet` solid and glowing.
The latch zone (`latchRadius`) as a very faint filled glow, brighter when the flying player is
within `gravityRadius` of that planet. Star heat: an arc around the orbit showing `heat`
(yellow→red). Crumble: an arc showing `crumble` progress. Blackholes: animated concentric
"gravity well" rings flowing inward within gravityRadius.

### js/render-special.js — `ORB.RenderSpecial` (NEW)
`drawStar(ctx, planet, time)`: a small sun — bright core, animated corona with flickering
flares/prominences, pulsing glow, color shifts toward white-hot as `heat` rises.
`drawBlackhole(ctx, planet, time)`: pitch-black core, bright photon ring, rotating
accretion disk (tilted ellipse of streaming particles, orange→violet), faint lensing halo.

### js/render-planets.js — `ORB.RenderPlanets` (REWRITE, same signature `draw(ctx, planets, time, currentPlanet)`)
Animated bodies for rocky / ice / gas / lava / jelly / crumble; delegates `star` and
`blackhole` to `ORB.RenderSpecial`. Requirements:
- Surface texture per planet generated once from `seed` into an offscreen canvas (cache by id,
  drop when planet pruned): rocky = craters+continents, ice = pale cracks+sparkles, gas =
  colored bands with swirls, lava = dark crust with glowing cracks, jelly = translucent with
  bubbles, crumble = cracked rock. The texture is ~2× wide and **scrolls horizontally with
  `rot`** inside a circular clip so the planet visibly rotates.
- Lighting: fixed light from top-left — radial shading overlay + terminator shadow.
- Atmosphere rim glow that softly pulses; ice and gas have a faster cloud layer.
- Rings (if `ringed`): tilted ellipse, back half behind the body, front half in front.
- Moons orbit (behind the body when on the far side).
- Squash & stretch: scale `(1 + wobble, 1 - wobble)` along `wobbleAngle`.
- Crumble: cracks widen and chunks drift off as `crumble` → 1; dead planets not drawn
  (game spawns debris particles).
- Lava emits occasional embers (via `ORB.Particles.burst(..., {type:'ember'})`, rate-limited).
- Cull planets off-screen (camera from `ORB.Camera`, view from `ORB.View`).

### js/render-entities.js (REWRITE) — `draw(ctx, stars, asteroids, powerups, comets, wormholes, time)`
Keep v1 visuals (improve freely), add comets (bright icy head, long fading tail from `tail`,
sparkle) and wormholes (swirling vortex rings: entry violet/pink, exit cyan, rotating spiral,
pulsing).

### js/render-player.js (REWRITE) — `draw(ctx, player, time)`
- Orbit: an **elastic tether** from the planet surface to the ship: quadratic curve whose
  control point lags behind against the motion; thickness/brightness grow with `stretch`
  (taut glowing line when stretched, thin slack when settled); a small glow knot at the ship.
- Orbit: **trajectory preview** using `ORB.Physics.predict(x, y, launchVelocity…, ORB.Planets.list, player.planet)`:
  dotted curve (dots spaced along the path, fading); cyan + a target ring on `hit` planet if it
  will latch, dim white otherwise. Only draw the first ~1.0 s of the path.
- Ship (skin colors from `ORB.Skins.current()`): body with two little panels, rotated along
  velocity, squash-stretch with speed, engine flame while `boostT > 0`; heat glow (red) when
  orbiting a star with heat > 0.4.
- Trail: tapered glowing ribbon, width and brightness by speed.
- Shield bubble, magnet aura (v1).

### js/hud.js (REWRITE, keep v1 API)
v1 DOM plus: `div.hud-height` (left of score area or under it: "123 м") with `setHeight(n)`,
`div.hud-void` full-width bottom edge glow whose intensity comes from CSS var `--void` set by
`setVoid(v 0..1)` (also toggles class `danger` when v > 0.6), `div.hud-toast` with
`toast(title, text)` (slides in from top for 2.6 s, queue multiple), and a combo ring:
`setCombo(n)` also fills `.hud-combo` with a CSS var `--combo` (n/MAX_COMBO).

### js/screens.js (REWRITE, keep v1 API/DOM)
Over screen data now `{ score, best, newBest, planets, reason, stats, newAchievements }`: show
height, a `div.stats-grid` of `div.stat-cell` (planets, stars, height, slingshots, comets,
wormholes), and a list of newly unlocked achievements. Menu: add `button.btn.btn-ghost.ach-btn`
"Achievements (got/total)" opening a 4th screen `section.screen.screen-achievements` with
`div.ach-list` of `div.ach` (`.locked` when not unlocked; name + desc) and a Back button.

### js/tutorial.js (REWRITE)
`shouldShow()` (v1), `show()`/`hide()`/`done()` (v1 = the 'launch' hint), plus `step(name)` →
shows a one-time hint for `name` (stored per name in 'tutorialSeen'), auto-hides after 3.2 s:
names `'launch'` (tapHint), `'gravity'` (tutGravity), `'void'` (tutVoid), `'star'` (tutStar),
`'blackhole'` (tutBlackhole), `'crumble'` (tutCrumble). Same DOM/classes as v1 (`#tutorial.show`
shows the hint; the text `p` is replaced per step).

### js/i18n.js (EDIT, add keys ru+en)
`height` (Высота), `meters` (м), `slingshot` (Гравиманёвр!), `cometRide` (Комета!), `warp`
(Червоточина!), `nearMiss` (На волоске!), `lostVoid` (Тьма догнала), `lostStar` (Сгорел у звезды),
`lostBlackhole` (Поглощён чёрной дырой), `achievements` (Достижения), `achievementUnlocked`
(Новое достижение), `back` (Назад), `stars` (Звёзды), `slingshots` (Манёвры), `comets` (Кометы),
`wormholes` (Червоточины), `heat` (Перегрев!), `crumbling` (Планета рушится!), `voidNear` (Тьма
близко!), `tutGravity` (Планеты притягивают — используй гравитацию, чтобы изогнуть полёт),
`tutVoid` (Снизу поднимается тьма — не останавливайся!), `tutStar` (Звезда перегревает — улетай
быстрее), `tutBlackhole` (Чёрная дыра! Пролети рядом ради бонуса, но не попадись), `tutCrumble`
(Эта планета рассыпается — прыгай дальше), `latched` (Пойман!).

### js/game.js — `ORB.Game` (REWRITE: integration of everything)
States as v1: `'menu' | 'play' | 'pause' | 'dying' | 'over'`. Boot as v1. Public API as v1
(`init, start, pause, resume, togglePause, toMenu, getState`) + `debug()` → `{ player, state }`.
- `setupWorld()`: reset Planets, Stars, Asteroids, Powerups, Comets, Wormholes, Particles, FX,
  TimeFX, Score; player = `Player.create(first)`; `Void.reset(first.y + VOID_START)`; camera reset;
  ensureAhead (for each created non-blackhole planet with its previous non-blackhole planet:
  Stars.spawnBetween, Powerups.maybeSpawnBetween, Wormholes.maybeSpawnBetween).
- Frame: `dt = TimeFX.update(realDt)`; in play `sdt = dt * (slowTime>0 ? SLOW_FACTOR : 1)`.
- Play update order: Planets.update(sdt) → Player.update(p, sdt) →
  - orbit: if planet.type 'star': `heat += STAR_HEAT_RATE*sdt` → ≥1 die('lostStar'), else
    heat cools 0.5/s when not orbited; if planet.dead (crumbled): Player.release, debris, Audio 'crumble'.
  - fly: `hit = Planets.findLatch(x, y, ignore)` where ignore = `p.ignoreT > 0 ? p.ignorePlanet : null` →
    onLatch: `s = Player.latch(p, hit)`; `Planets.impact(hit, s, angle)`; Audio 'latch'(s);
    Haptics; Particles.ring + burst; Camera.shake(3+6s); TimeFX.hitstop(0.03+0.05s) if s>0.5;
    if not visited: visited, Score.addPlanet(flyTime), popup "+pts", perfect → popup/flash/'perfect';
    crumble type → startCrumble + tutorial 'crumble'; star → tutorial 'star'.
    Black hole: `Planets.blackholeKill` → die('lostBlackhole'); if within 2.4×radius of a
    blackhole (once per blackhole per flight) → Score.addBonus('slingshot'), popup, Audio
    'slingshot', TimeFX.slowmo(0.45, 0.6), blackholePasses++. Also: a free flight whose path
    bent > 50° by gravity (compare launch dir vs. current dir) and then latches → slingshot bonus.
    Death: flyTime > MAX_FLY_TIME → 'lostTime'; x outside `[-90, WORLD_W+90]` → 'lostScreen'.
  - Void.update; `Planets.consume(Void.y)`; if `p.y > Void.y` → die('lostVoid'); if orbiting a dead planet → die('lostVoid').
  - Stars / Powerups (v1), Asteroids (+ nearMiss bonus), Comets (touch → v += normalized comet v *
    COMET_BOOST, bonus 'comet', popup, Audio 'comet', burst), Wormholes (teleport → bonus
    'wormhole', Audio 'warp', shockwave at both ends, flash).
  - Score.setHeight(p.y), trackSpeed; HUD (score, height, powerups, void danger), FX.setDanger
    (from Void distance), FX.setSpeed(speed), Music.setIntensity(max(danger, combo/5)).
  - Achievements.check(Score.stats()) after scoring events → HUD.toast + Audio 'achievement'.
  - Tutorials: 'launch' at start, 'gravity' on first flight with strong gravity, 'void' when void
    is within 0.5 view height.
  - Camera: targetY = (orbit ? planet.y : p.y + p.vy*0.12) - View.h*CAMERA_LEAD; targetX =
    WORLD_W/2 + (p.x - WORLD_W/2)*0.25; zoom = 1 - (1-ZOOM_MIN)*smooth((speed-LO)/(HI-LO)).
  - ensureAhead (topY = Camera.y - visibleH*1.2), prune with bottomY = max(Void.y, Camera.y + visibleH).
- Menu/over: world animates (planets update, player orbits, void stays far), music low.
- `die(reason)`: as v1 + debris, shockwave, flash red, TimeFX.slowmo(0.3, 0.8), Audio 'death'.
  `finishDeath()`: best, `Achievements.check`, Screens.show('over', {..., stats, newAchievements}).
- Render: screen transform + Background.draw → world transform with zoom → RenderOrbits →
  RenderPlanets → RenderEntities (stars, asteroids, powerups, comets, wormholes) → Particles →
  RenderPlayer → FX.drawWorld → Void.draw → screen transform → FX.drawScreen.
- Music.start() on first user gesture (in onTap / Play), respects mute (sound toggle also
  calls Music.setMuted).

### css/style.css (EDIT)
Keep v1; add styles for `.hud-height`, `.hud-void` (+`.danger` pulsing), `.hud-toast`(.show),
`.hud-combo` ring using `--combo`, `.stats-grid`, `.stat-cell`, `.ach-btn`, `.screen-achievements`,
`.ach-list`, `.ach`, `.ach.locked`, `.new-ach` list on over screen. Responsive as v1
(320px portrait → 4K, short landscape).

### tools/check.js (EDIT)
Update to the v2 file list and APIs; headless simulation: verify tether dynamics settle
(a ship latched with an outward velocity ends within 3 px of orbitRadius after 3 s), gravity
bends a flight, predict() returns a hit for an aimed launch, a bot that launches when
`predict().hit` is a higher planet climbs ≥ 15 planets before dying in ≥ 3 of 5 runs.
