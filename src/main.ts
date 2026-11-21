import { connectHubLaunch, type PeerMatch } from "./hub/peer-match";
import { hubUrl } from "./hub/navigation";
import { createGame } from "./index";
import { consumeRoomRequest } from "./hub/navigation";
import { restorePlayerName } from "./hub/supabase";
async function openPeerMatch(launch: Promise<PeerMatch>) {
  const root = document.getElementById("app")!;
  const panel = document.createElement("section");
  panel.className = "csw-peer-status";
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  status.textContent = "Connecting to the other player…";
  const back = document.createElement("a");
  back.href = hubUrl() + "?game=cs-web";
  back.textContent = "Back to Game Hub";
  panel.append(status, back);
  root.append(panel);
  try {
    const peer = await launch;
    let game: Awaited<ReturnType<typeof createGame>> | undefined;
    let ended = false;
    let generation = 0;
    back.addEventListener("click", event => {
      if (window.parent !== window) event.preventDefault();
      peer.close(true);
      game?.destroy();
    });
    peer.onStatus = message => {
      panel.hidden = !message;
      status.textContent = message;
    };
    peer.onEnd = message => {
      ended = true;
      game?.destroy();
      panel.hidden = false;
      status.textContent = message;
    };
    peer.onOpen = async () => {
      const current = ++generation;
      game?.destroy();
      const mounted = await createGame(root, {
        peer, autostart: true, playerName: peer.launch.host ? peer.launch.hostName : peer.launch.peerName,
        onExit: () => { if (window.parent === window) location.assign(back.href); },
      });
      if (ended || current !== generation) mounted.destroy();
      else game = mounted;
    };
    window.addEventListener("pagehide", event => {
      if (!event.persisted) { game?.destroy(); peer.close(); }
    }, { once: true });
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "The match could not open.";
  }
}
const launch = connectHubLaunch();
if (launch) await openPeerMatch(launch);
else await openSolo();

async function openSolo() {
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

}
