# Counter-Attack-Web

**CS Web (fan project)**

A browser FPS for desktop keyboard and mouse, with standalone solo play and two-player matches through Game Hub. Choose Dust2 or Mirage, pick a side, and play a five-on-five match with nine bots. Both teams change sides after 12 rounds. The first team to 13 wins, and 12–12 ends in a draw.

## Play locally

Use Node.js 22.12 or later. From this directory run:

```sh
npm ci
npm run dev
```

Open [the game lobby](http://127.0.0.1:5177/cs-web/). Choose a callsign and **Start match**. Click the game view to capture the mouse. An existing Game Hub guest session is optional.

| Control | Action |
| --- | --- |
| W A S D / mouse | Move / look |
| Shift / Ctrl / Space | Walk / crouch / jump |
| Left mouse / right mouse | Fire / cycle scope zoom |
| R / Q / wheel | Reload / previous equipment / cycle equipment |
| 1 / 2 / 4 / 5 | Primary / pistol / grenade / carried objective |
| Hold and release mouse with a grenade | Throw after the pin pull. Left gives a full throw, right a lob, both a medium throw. |
| Hold E | Plant at A or B while carrying the objective, or defuse beside it |
| B / Tab / Esc | Buy menu / hold scoreboard / pause |

Open the buy menu in your spawn during the 15-second freeze or the first 20 seconds of live play. Number keys select an armory category. Use Tab and Enter to select a purchase. The timer, current balance and equipped weapon appear in the HUD. A surviving player keeps their loadout into the next round. Use the lobby settings to adjust sensitivity, volume, field of view, crosshair, HUD scale, and shadows.

## Other entry points

- [Practice range](http://127.0.0.1:5177/cs-web/?scene=range&debug=1) has stationary targets, material panels, a spray wall, and buying throughout the range. Add `&side=T` for the attacking team's rifle.
- [Watch a bot match on Mirage](http://127.0.0.1:5177/cs-web/?autostart=1&botsonly=1&map=mirage) uses the same match and physics rules.
- Add `debug=1` to show navigation geometry, frame rate, recoil, and penetration feedback. Add `fly=1` for a free camera. Use Space and Ctrl to move vertically.
- `npm run build` type-checks and produces `dist/`. Serve it at `/cs-web/`. `npm run preview` serves that build at [port 4177](http://127.0.0.1:4177/cs-web/).

## Verification

| Command | Coverage |
| --- | --- |
| `npm test` | Damage, penetration, utility, movement, economy, objectives, round transitions, navigation, identity, and CSP |
| `npm run check:map` | Spawn-to-site connectivity, link clearance, route timings |
| `npm run map:svg -- mirage` | Regenerate a map schematic under `docs/maps` |
| `npm run test:soak` | Deterministic ten-bot matches on both maps with objective and tick statistics |
| `npm run build && npm run test:browser` | Match setup, buying, shooting, reloading, scoreboard, pause, and repeated WebGL teardown |

The browser checks use Edge on Windows. On other platforms install the Playwright Chromium browser with `npx playwright install chromium`, or select an installed channel with `CS_WEB_BROWSER_CHANNEL`.

## GitHub Pages

Set the repository's Pages source to **GitHub Actions**. The **Deploy GitHub Pages** workflow builds and publishes `dist/` after a push to `main`, with asset URLs rooted at the repository's Pages path. Local builds default to `/cs-web/` for Game Hub.

[Play on GitHub Pages](https://vortezler.github.io/Counter-Attack-Web/)

## Game Hub multiplayer

Open Counter-Attack Web lobbies from Game Hub, create or join a two-seat room, and wait for the creator to start it. Both players then select **Open match**. The creator plays CT and runs the simulation, and the guest plays T. Eight bots fill the remaining slots on Dust2 with normal difficulty. The existing solo menu includes both maps and difficulty settings.

Leave the Game Hub lobby tab open and keep the host game tab visible. Gameplay uses a direct WebRTC data channel. Game Hub provides room admission and exchanges offers and answers through its own tab. If the guest reloads, they can reconnect to the host’s current match. Relaunching the host game starts a fresh match. Leave the lobby to end it for both players.

Some networks block direct connections. There is no relay server. The host controls this casual match, so play with someone you trust.


The standalone build works with no backend configuration. For guest restoration, copy `.env.example` to `.env.local` and set the same browser-safe Supabase URL and publishable key as Game Hub. Serve the two applications on the same origin for shared guest storage. The game stores local preferences under `cs-web:` and signs in no new users.

The integration bundle contains a reviewable patch, an end-to-end browser spec, screenshots, and shared-origin setup instructions. See [the integration guide](docs/hub-integration/PR.md).

## Source

`src/index.ts` exports `createGame(container, options)`, an async mount that returns a handle with `pause`, `resume`, `resize`, event subscriptions, and `destroy`. The renderer and HUD consume the 64 Hz simulation. A future authoritative runtime could instantiate `Sim` after `initPhysics()`, deliver tick-indexed player commands through `step(commands)`, and forward snapshots and events to clients. Multiplayer would also need input validation, reconciliation, and a trusted transport.

Maps, models, menu artwork, textures, and sounds are original. See [tuning and verification](TUNING.md), [implementation decisions](DECISIONS.md), and [third-party licenses](THIRD_PARTY.md).
