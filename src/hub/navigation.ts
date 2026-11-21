export function hubUrl(): string {
  const parent = new URLSearchParams(location.hash.slice(1)).get("parent");
  if (location.hostname === "127.0.0.1" && parent === "http://127.0.0.1:4175") return parent + "/game-hub/";
  if (import.meta.env.DEV) return "http://127.0.0.1:5173/game-hub/";
  return location.hostname === "vortezler.github.io" ? "https://kumori1313.github.io/game-hub/" : "/game-hub/";
}

export function consumeRoomRequest(): string | null {
  const url = new URL(window.location.href);
  const requested =
    url.searchParams.get("lobby") ?? url.searchParams.get("room");
  if (requested === null) return null;
  const valid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(
    requested,
  );
  url.searchParams.delete("lobby");
  url.searchParams.delete("room");
  history.replaceState(history.state, "", url.pathname + url.search + url.hash);
  return valid
    ? "Shared rooms for CS Web aren’t available yet. You can play a solo match against bots."
    : "This room link is invalid. You can play a solo match against bots.";
}
