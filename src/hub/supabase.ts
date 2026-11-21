import { createClient } from "@supabase/supabase-js";
import { createGuestService, displayName } from "./guest";
import { localPlayerName } from "./storage";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Both project paths share an origin in production. Keep this key identical.
export const supabase =
  url && key
    ? createClient(url, key, {
        auth: {
          storageKey: "game-hub-auth",
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
        },
      })
    : null;

export async function restorePlayerName(): Promise<string> {
  const fallback = localPlayerName();
  if (!supabase) return fallback;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const restored = createGuestService(supabase).restore().then(displayName);
    const deadline = new Promise<null>((resolve) => {
      timeout = setTimeout(() => resolve(null), 2000);
    });
    return (await Promise.race([restored, deadline])) ?? fallback;
  } catch {
    return fallback;
  } finally {
    clearTimeout(timeout);
  }
}
