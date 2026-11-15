# NEON PURSUIT – 3D police-chase browser game (Three.js + Vite)

Original game inspired by arcade open-world chase games. 14 drivable cars, 2 bridges, live-banked money. No external assets: all models, textures and audio are procedural.

## Run it
```bash
npm install
npm run dev        # open the printed URL (http://localhost:5173) in Chrome / Edge / Firefox
```
Production build: `npm run build && npm run preview`.

## Controls
W/↑ accelerate · S/↓ brake/reverse · A D/←→ steer · Space handbrake · Shift nitro · C camera · R recover onto road · H key hints · Esc pause · mouse-drag look around

## Structure (src/)
world.js city, bridges, collision hash, day/night · props.js instanced destructibles · vehicles.js procedural cars · physics.js tyre/rigid-body model + collisions ·
traffic.js / police.js AI (intercept, flank, block, ram, pathfinding, roadblocks, helicopter) · game.js loop, wanted level, scoring, challenges · camera.js · fx.js/particles.js · audio.js (Web Audio) · ui.js HUD/menus/garage · save.js (localStorage) · data.js vehicles/upgrades/challenges

## Maps

The **Play** button first asks for a map, then for what to do on it.

**Neon City** – Free Roam, Police Chase and 12 city challenges (police, distance, drifting).

**Touge Pass** – a 4.8 km mountain loop built for drifting: switchback hairpins, fast sweepers, a long climb back to the summit and an open
**Drift Park** in the valley. No police and no traffic.
- *Free Drift* – no timer, chain slides and clip the orange apex markers (+bonus, +0.5 multiplier each).
- *Touge Run* – one lap from the summit; score = banked drift points + time bonus.
- *Drift Park* – freestyle lot with painted donut zones (x1.6 points) and a cone slalom.
- *Challenges* – 10 drift objectives (apexes, chains, drift angle, speed, laps, clean lap, donut zone…).

**Powerslides (both maps):** tap the **handbrake (Space or X) while steering**, then keep the **throttle** down and the car slides.
Steer *into* the turn for a bigger angle (~35°), leave the wheel neutral for ~20°, steer *against* it for a small angle (~10°).
Lift off, brake or straighten out to regrip. A powerslide never gains speed. Outside a powerslide the cars use normal, forgiving handling
(stabilising torque, ABS-like braking), so driving without the handbrake stays easy. Hitting a wall or spinning out loses your current drift chain.

## Cars, prices and money (v4)
- 28 cars in six garage categories: Regular, Sport, Drift, Hyper, Heavy, Meme.
- Every car has a **Rating** (speed, acceleration, handling, braking, durability). Price follows one curve of rating, so price always matches strength (meme cars have a small novelty markup).
- **Points are cyan (PTS)**, **money is gold ($)**. Money = 15% of your points plus bonuses. The run summary shows PTS → $ explicitly.

## Play online / publish on GitHub
1. Create a new GitHub repository and push this folder to the `main` branch.
2. In the repo go to **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Every push to `main` now builds and publishes the game to `https://<your-username>.github.io/<repo-name>/`.

Licence: MIT (see `LICENSE`). Built with [Three.js](https://threejs.org/) (MIT).
