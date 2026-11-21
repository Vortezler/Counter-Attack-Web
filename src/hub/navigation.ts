export function hubUrl(): string {
  return import.meta.env.DEV ? "http://127.0.0.1:5173/game-hub/" : "/game-hub/";
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
