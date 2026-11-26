# Gameplay tuning and verification

## Where to tune

| Source | Values and behavior |
| --- | --- |
| `src/config/weapons.ts` | Weapon prices, magazine sizes, reloads, cadence, armor modifiers, penetration limits, weapon-dependent movement and spread |
| `src/config/recoilPatterns.ts` | Cumulative pitch/yaw by shot index. The first entry represents the first shot of a rested burst. |
| `src/sim/rules.ts` | Fixed timestep, unit conversion, ground/air acceleration, friction, armor, material resistance, range falloff, money caps, and A* |
| `src/sim/Physics.ts` | Collision filtering, hitboxes, stairs, grounded movement, material thickness queries, and utility bodies |
| `src/sim/Sim.ts` | Inventory, reloads, recoil recovery, grenade effects, cash awards, round transitions, objective timers and side swap |
| `src/sim/bots.ts` | Difficulty-dependent reaction delay and aim error, waypoint following, range thresholds, engagement decisions and utility use |
| `src/world.ts` | Traversable routes, cover, elevations, materials, spawns, buy zones and sites |
| `src/render.ts` and `src/audio.ts` | Graphics settings, original models, pooled effects, spatial sound and audio occlusion |

## Reproduce the checks

- Open the practice range with `?scene=range&debug=1`. Buy a weapon with **B**, then compare standing, running, crouched, and repeated shots. The debug display shows the recoil pattern, current material and remaining damage. A yellow hit marker and text identify a hit through cover.
- `npm test` exercises the same Rapier simulation used by the game. Tests cover bullets traversing one, four, and five thin panels, blocking on concrete, armor and hit groups, grenade release and bounce, flash facing, crouch/jump, buying, and interrupted or completed round objectives.
- `npm run check:map` checks both graphs, including capsule-width clearance and authoring timing windows. Sandgate has 202 connected nodes and Saffron has 191. Measured route lengths, converted at 250 units per second, put Sandgate Long at 16.7 seconds and Saffron Palace at 15.4 seconds. Both are within the plan’s tolerance.
- `npm run test:soak` runs two seeds per map with all ten players controlled by bots. Each match ends under standard first-to-13 or draw rules. The reported mean includes all simulated ticks. Browser rendering is measured separately.
- `npm run build` followed by `npm run check:performance` samples live matches in Edge or Chromium at 1920 × 1080. Each sample begins after freeze time and lasts 6.5 seconds. The benchmark prints the graphics adapter, actual framebuffer dimensions and frame timings.

## Recorded results, November 21, 2026

The production build passed strict TypeScript checking, and all 34 unit and simulation tests passed. The browser match test exercised map selection, purchasing, firing, reloading, the scoreboard and pause. A separate Chromium lifecycle check mounted and destroyed three matches, released all three WebGL contexts and pointer lock, and found zero pending animation frames or remaining signal-bound game listeners. Retained JavaScript heap growth from the first teardown to the third was about 0.51 MB in the recorded run.

| Map | Seeds | Completed rounds | Eliminations | Plants | Defuses | Timeouts |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Sandgate | 713, 3479 | 36 | 236 | 22 | 11 | 0 |
| Saffron | 713, 3479 | 44 | 276 | 33 | 15 | 0 |

Mean simulation time was 0.085–0.101 ms per tick across the four runs. On Intel UHD Graphics using D3D11 in headless Edge, the short live samples averaged 77 FPS on Sandgate and 76 FPS on Saffron. Median frame time was 12.1 ms on both maps. The 95th percentile was 18.4 ms on Sandgate and 23.9 ms on Saffron. These measurements cover the sampled views and hardware. Full-match graphics performance on other machines and subjective handling feel still need player feedback.

[Game Hub verification and screenshots](docs/hub-integration/PR.md)
