# Implementation decisions

- The game lives under `cs-web/` in the supplied workspace. The Game Hub contribution is a patch prepared against its local checkout. A temporary copy was used for integration testing.
- Dust2 and Mirage use original blockout geometry and mapped routes, landmarks, and callouts. Their dimensions and elevations are approximations. The annotated schematics show the implemented layout.
- The simulation stores positions in metres. One Source unit is 0.0254 m, and weapon values, gravity, jump and movement targets are converted at the sim boundary. The fixed tick interval is 1/64 second.
- The weapon table specifies 98 maximum HE damage while a checklist asks for a point-blank kill from full health. The simulation uses the 98-damage falloff. The AWP uses its armor penetration fraction directly to preserve the specified near-range chest one-shot. Other firearms use the plan’s half-ratio armor rule.
- A 10-unit wood panel leaves 27.51 damage from the specified 36-damage rifle shot. The tests use the formula, which rounds to the plan’s approximate 28-damage target.
- Each new round refills surviving weapons. Teams buy within their own zones. Bots use different route waypoints and restrict firing range by weapon so rounds advance toward the objective.
- The opening lobby loads independently of Three.js and Rapier. The first match lazily loads the renderer and the physics package with embedded WebAssembly. The resulting Rapier chunk exceeds Vite’s default size warning threshold.
- The game CSP adds the WebAssembly-specific permission for Rapier. If a host disallows WebAssembly, an alternative collision engine or controller would be required before deployment. The standalone build has no remote asset dependencies.
- Single-player state lasts for the current page. The project ships a GitHub Pages workflow for the owner to use once the game has an approved hosting origin.
