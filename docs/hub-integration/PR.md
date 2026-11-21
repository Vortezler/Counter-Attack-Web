# CS Web for Game Hub

## Review scope

Add a gated catalog link for **CS Web**, an unofficial desktop browser FPS. Each match seats one human and nine local bots in two teams of five. Attackers can plant the objective on either site. Defenders can defuse it or run down the round clock. The first team to 13 wins. Teams change sides after 12 rounds and a 12–12 match ends in a draw.

| Item | Proposed configuration |
| --- | --- |
| Game ID and route | `cs-web` at `/cs-web/` |
| Development entry | `http://127.0.0.1:5177/cs-web/` |
| Shared-origin test server | `http://127.0.0.1:4175/game-hub/` and `/cs-web/` |
| Production | Reviewed deployment under the hub owner’s origin at `https://kumori1313.github.io/cs-web/` |
| Catalog gate | Set the hub’s `VITE_ENABLE_CS_WEB=true` at build time after the game is available |
| Source | The standalone `cs-web` project accompanying this patch |
| License | MIT for game code and original art and audio. Third-party licenses are listed in [THIRD_PARTY.md](../../THIRD_PARTY.md). |

## Prepare the hub contribution

The patch follows the supplied Game Hub checkout at `a976e2e`. It adds the entry to the catalog, the static root and asset MIME types to the session server, the game checkout to release validation, the Pages flag, browser tests, and the hub’s setup notes.

From a maintainer’s review branch in Game Hub, substitute the actual game checkout path and run these commands.

```powershell
$patch = 'C:\path\to\cs-web\docs\hub-integration\hub-patch\game-hub.patch'
git apply --check $patch
git apply $patch
```

## Build and verify

1. In CS Web, run `npm ci`, `npm test`, and `npm run build`. The entry document and bundled assets are in `dist/`.
2. In a patched hub checkout, install dependencies with `npm ci`. Configure its local Supabase backend following the hub’s setup guide. Supply identical browser-safe `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in both checkouts and rebuild both. Set the hub’s `VITE_ENABLE_CS_WEB=true`.
3. In the hub, set `CS_WEB_SITE_DIR` to the absolute game checkout path. Run `npm run build`, then `node --env-file=.env.local scripts/serve-session-test.mjs`. Enter a guest on the hub, choose **Play CS Web**, and return using **Back to Game Hub**.
4. Stop that server and run `npm run test:cs-web` for the same-origin browser suite. Set `CS_WEB_SCREENSHOTS` to an output directory to capture the catalog, lobby, and return flow. The patched hub also runs these tests as part of its full browser suite. `npm run test:release` requires the other three game checkouts and the migrated local backend.

## Identity, runtime, and recovery

The hub and game use the shared Supabase project and `game-hub-auth` storage key. The game verifies an existing session and displays the validated name. Missing identities and temporary network failures fall back to a local callsign. Solo entry does not create an account. A room link displays a notice and removes both room query aliases. Refresh returns to the same static entry document.

Match state lives in the page and ends when the user reloads or leaves. The server has no seat, score, or membership to release. Locally saved names and preferences use the `cs-web:` prefix. The game adds `'wasm-unsafe-eval'` to its own script policy for Rapier’s embedded WebAssembly. The hub’s policy stays intact.

## Future shared matches

A shared mode would need a reviewed database catalog entry, private room adapter, authoritative action validation, private per-player views, and agreed policies for reconnecting, abandonment, match results, and rematches. Existing 2–6-seat limits need revision for a ten-player match. A 64 Hz FPS also needs a dedicated trusted real-time transport. The hub’s polling and heartbeat model suits turn-based actions. Relay Room’s separate runtime is a reference for integrating a future server.

## Verification record

- The patch passes `git apply --check` against the local Game Hub checkout at `a976e2e`.
- Eleven CS Web guest, navigation, storage, and security-policy unit tests pass. The isolated patched hub’s eight existing guest/security tests pass.
- The isolated patched hub builds, and its catalog flag test passes in headless Microsoft Edge with the card both enabled and disabled.
- All seven enabled-card browser cases passed on the shared local origin. They exercised identity restoration, fallback during an auth outage, room-link recovery, live round progression under CSP, small-screen keyboard navigation, purchasing a defuse kit, and the return link. For this run an in-memory Supabase-compatible auth fixture supplied temporary test users.
- The game’s standalone browser suite exercised shooting, reloading, the scoreboard, and three mount/destroy cycles. Match simulation, frame-rate measurements and test commands appear in [TUNING.md](../../TUNING.md).
- Local Supabase and the other game checkouts are required to run the full multi-game release suite. Live guest-service verification remains a maintainer acceptance step.

## Captured screens

[Hub catalog](screenshots/hub-card.png) · [Match lobby](screenshots/game-menu.png) · [Mirage buy menu](screenshots/buy-menu.png) · [Verified range hit through cover](screenshots/range-wallbang.png) · [Return to the hub](screenshots/hub-return.png)
