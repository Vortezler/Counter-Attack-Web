import type { SupabaseClient } from "@supabase/supabase-js";

export function validateDisplayName(value: string) {
  const name = value.trim();
  if (!name) throw new Error("Enter a display name.");
  if ([...name].length > 24) throw new Error("Use 24 characters or fewer.");
  if (
    /[\p{Cc}\p{Cs}\p{Zl}\p{Zp}]/u.test(name) ||
    /[\p{Cc}\p{Cs}\p{Zl}\p{Zp}]/u.test(value)
  ) {
    throw new Error(
      "Use printable characters without line breaks or control characters.",
    );
  }
  if (
    /[\u061c\u200b\u200e\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u.test(name)
  ) {
    throw new Error("Remove invisible formatting characters from your name.");
  }
  return name;
}

export function displayName(
  user: { user_metadata?: { display_name?: string } } | null | undefined,
) {
  try {
    return validateDisplayName(user?.user_metadata?.display_name ?? "");
  } catch {
    return null;
  }
}

export function createGuestService(
  client: Pick<SupabaseClient, "auth"> | null,
) {
  if (!client)
    throw new Error("Guest entry is unavailable. Please try again later.");
  return {
    async restore() {
      const {
        data: { session },
        error,
      } = await client.auth.getSession();
      if (error) throw error;
      if (!session) return null;
      const { data, error: verifyError } = await client.auth.getUser();
      if (verifyError) {
        // Invalid identity requires new entry; network failures retain the saved session.
        if (
          verifyError.status === 401 ||
          verifyError.status === 403 ||
          verifyError.name === "AuthSessionMissingError"
        ) {
          await client.auth.signOut({ scope: "local" });
          return null;
        }
        throw verifyError;
      }
      return data.user;
    },
    async save(value: string) {
      const name = validateDisplayName(value);
      const existing = await this.restore();
      const response = existing
        ? await client.auth.updateUser({ data: { display_name: name } })
        : await client.auth.signInAnonymously({
            options: { data: { display_name: name } },
          });
      if (response.error) throw response.error;
      return response.data.user;
    },
  };
}
