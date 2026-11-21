import { createGame } from "./index";
import { consumeRoomRequest } from "./hub/navigation";
import { restorePlayerName } from "./hub/supabase";
const q = new URLSearchParams(location.search),
  notice = consumeRoomRequest() ?? undefined;
const name = await restorePlayerName();
const game = await createGame(document.getElementById("app")!, {
  playerName: name,
  notice,
  map: q.get("map") === "mirage" ? "mirage" : "dust2",
  side: q.get("side") === "T" ? "T" : "CT",
  difficulty:
    q.get("difficulty") === "easy"
      ? "easy"
      : q.get("difficulty") === "hard"
        ? "hard"
        : "normal",
  scene: q.get("scene") === "range" ? "range" : undefined,
  debug: q.get("debug") === "1",
  fly: q.get("fly") === "1",
  botsOnly: q.get("botsonly") === "1",
  autostart:
    q.get("autostart") === "1" ||
    q.get("scene") === "range" ||
    q.get("fly") === "1",
});
window.addEventListener(
  "pagehide",
  (e) => {
    if (!e.persisted) game.destroy();
  },
  { once: true },
);
if (import.meta.hot) import.meta.hot.dispose(() => game.destroy());
