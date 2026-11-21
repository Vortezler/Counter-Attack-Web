# Counter-Attack-Web

**CS Web (fan project)**

A browser FPS for desktop keyboard and mouse, also packaged as an Android app with touch controls, with standalone solo play and two-player matches through Game Hub. Choose Dust2, Mirage, Nuke, Inferno or Vertigo, Competitive (friendly fire) or Casual (free armor, CT defuse kits, no friendly fire), pick a side, and play a five-on-five match with nine bots. Both teams change sides after 12 rounds. The first team to 13 wins, and 12–12 ends in a draw.

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
| 1 / 2 / 4 / 5 | Primary / pistol / cycle grenades (HE, flash, smoke, molotov) / carried objective |
| Esc | Leave fullscreen and pause; every other bind can be changed under Controls |
| 3 | Knife: left click slashes (40), right click stabs (65); a stab from behind always kills |
| Right mouse with the Glock | Toggle three-round burst fire |
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
| `npx tsx scripts/sightlines.ts` | No line of sight between the two spawn buy zones on any map (also covered by `npm test`) |
| `node scripts/capture.mjs` | With `npm run dev` running, re-renders lobby art for Nuke, Inferno and Vertigo |
| `npm run map:svg -- mirage` | Regenerate a map schematic under `docs/maps` |
| `npm run test:soak` | Deterministic ten-bot matches on both maps with objective and tick statistics |
| `npm run build && npm run test:browser` | Match setup, buying, shooting, reloading, scoreboard, pause, repeated WebGL teardown, and phone-browser touch controls |
| `npm run test:android` | With the debug app open on an emulator or phone, 33 multi-touch checks of the Android build |

The browser checks use Edge on Windows. On other platforms install the Playwright Chromium browser with `npx playwright install chromium`, or select an installed channel with `CS_WEB_BROWSER_CHANNEL`.

## Android app

`android/` is a [Capacitor](https://capacitorjs.com/) project that ships the same TypeScript, Three.js and Rapier game in an Android WebView. It runs landscape only, full screen with the system bars hidden, keeps the screen awake, and keeps the HUD clear of camera cutouts. It needs the Android SDK (API 36) and JDK 21; Android Studio's bundled `jbr` works.

```sh
npm run build:android                    # type-check, bundle into dist-android/, copy into android/
cd android && ./gradlew assembleDebug    # writes app/build/outputs/apk/debug/app-debug.apk
```

Or open `android/` in Android Studio, or run `npm run android` to build and launch on a connected phone or emulator.

Touch controls are invisible during play. At the start of each match a very faint outline shows where they are, and it fades when the first round goes live. **Show touch layout** in the in-game settings brings it back for a few seconds, and the lobby's Controls dialog has a diagram.

| Touch | Action |
| --- | --- |
| Left side: put a thumb down and drag | Move with a floating stick; a light push walks |
| Right side: drag | Aim |
| Fire, around the right thumb | Hold to fire; keep dragging on it to aim while firing |
| Scope, Reload, Use, Jump, Swap, Crouch | Buttons around Fire. Crouch toggles; Swap returns to the last weapon |
| Radar | Buy menu |
| Score at the top | Hold for the scoreboard |
| Inventory row | Draw that weapon or grenade |
| Objective prompt | Hold to plant or defuse |
| Top-right corner, or Back | Pause; Back also resumes and closes menus |

Phone browsers get the same controls and ask for landscape. `npm run test:android` drives the installed debug app through the WebView's DevTools socket, and `npm run android:icons` regenerates the launcher icons and splash images from `public/mark.svg`.

## GitHub Pages

Set the repository's Pages source to **GitHub Actions**. The **Deploy GitHub Pages** workflow builds and publishes `dist/` after a push to `main`, with asset URLs rooted at the repository's Pages path. Local builds default to `/cs-web/` for Game Hub.

[Play on GitHub Pages](https://vortezler.github.io/Counter-Attack-Web/)

## Game Hub multiplayer

Open Counter-Attack Web lobbies from Game Hub, create or join a two-seat room, and wait for the creator to start it. Both players then select **Open match**. The creator plays CT and runs the simulation, and the guest plays T. Eight bots fill the remaining slots on Dust2 with normal difficulty. The existing solo menu includes both maps and difficulty settings.

The match opens inside the Game Hub tab. Browsers share connection candidates while establishing direct WebRTC and use private Game Hub Realtime messages if a direct path is unavailable. On the relay, the guest sees local movement immediately and adjusts to the host's snapshots. The host resolves damage, purchases, and round outcomes over either connection. The guest can reopen an active match and resume from the host’s state. Relaunching the host game starts a fresh match. Leave the lobby to end it for both players.

On a phone, use the touch controls described under [Android app](#android-app). Keep the host tab active on mobile because the browser can suspend it in the background. The host controls this casual match, so play with someone you trust.


The standalone build works with no backend configuration. For guest restoration, copy `.env.example` to `.env.local` and set the same browser-safe Supabase URL and publishable key as Game Hub. Serve the two applications on the same origin for shared guest storage. The game stores local preferences under `cs-web:` and signs in no new users.

The integration bundle contains a reviewable patch, an end-to-end browser spec, screenshots, and shared-origin setup instructions. See [the integration guide](docs/hub-integration/PR.md).

## Source

`src/index.ts` exports `createGame(container, options)`, an async mount that returns a handle with `pause`, `resume`, `resize`, event subscriptions, and `destroy`. The renderer and HUD consume the 64 Hz simulation. A future authoritative runtime could instantiate `Sim` after `initPhysics()`, deliver tick-indexed player commands through `step(commands)`, and forward snapshots and events to clients. Multiplayer would also need input validation, reconciliation, and a trusted transport.

Maps, models, menu artwork, textures, and sounds are original. See [tuning and verification](TUNING.md), [implementation decisions](DECISIONS.md), and [third-party licenses](THIRD_PARTY.md).
