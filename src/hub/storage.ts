import { validateDisplayName } from "./guest";

export function readSetting<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem("cs-web:" + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writeSetting(key: string, value: unknown): void {
  try {
    localStorage.setItem("cs-web:" + key, JSON.stringify(value));
  } catch {
    /* The current match still works with storage disabled. */
  }
}

export function localPlayerName(): string {
  try {
    return validateDisplayName(
      localStorage.getItem("cs-web:player-name") ?? "",
    );
  } catch {
    return "Player";
  }
}

export function savePlayerName(value: string): string {
  const name = validateDisplayName(value);
  try {
    localStorage.setItem("cs-web:player-name", name);
  } catch {
    /* Local persistence is optional. */
  }
  return name;
}
