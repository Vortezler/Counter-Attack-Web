import { afterEach, test, vi } from "vitest";
import assert from "node:assert/strict";
import {
  validateDisplayName,
  displayName,
  createGuestService,
} from "../src/hub/guest";
import {
  localPlayerName,
  savePlayerName,
  readSetting,
  writeSetting,
} from "../src/hub/storage";
import { consumeRoomRequest } from "../src/hub/navigation";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("names trim whitespace, count Unicode code points, and reject control characters", () => {
  assert.equal(validateDisplayName("  Alex 🦊  "), "Alex 🦊");
  assert.equal(validateDisplayName("🦊".repeat(24)), "🦊".repeat(24));
  for (const value of [
    "",
    "   ",
    "a".repeat(25),
    "Alex\n",
    "A\u0000B",
    "A\u202eB",
    "\ud800",
  ]) {
    assert.throws(() => validateDisplayName(value));
  }
  assert.equal(
    displayName({ user_metadata: { display_name: "\u0000" } }),
    null,
  );
});

test("returning guests keep their identity when changing a display name", async () => {
  const user = { id: "same-guest", user_metadata: { display_name: "Alex" } };
  const client = {
    auth: {
      getSession: async () => ({ data: { session: {} } }),
      getUser: async () => ({ data: { user } }),
      updateUser: async ({ data }) => ({
        data: { user: { ...user, user_metadata: data } },
      }),
      signInAnonymously: async () =>
        assert.fail("must not create another guest"),
    },
  };
  const updated = await createGuestService(client).save("  Sam  ");
  assert.equal(updated.id, "same-guest");
  assert.equal(displayName(updated), "Sam");
});

test("new guests receive the validated name in auth metadata", async () => {
  const client = {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      signInAnonymously: async ({ options }) => ({
        data: { user: { id: "new", user_metadata: options.data } },
      }),
    },
  };
  assert.equal(
    displayName(await createGuestService(client).save("Alex")),
    "Alex",
  );
});

test("network failures never discard an existing session or create another guest", async () => {
  const client = {
    auth: {
      getSession: async () => ({ data: { session: {} } }),
      getUser: async () => ({
        error: { status: 0, message: "Network failed" },
      }),
      signOut: async () => assert.fail("must retain saved session"),
      signInAnonymously: async () =>
        assert.fail("must not create another guest"),
    },
  };
  await assert.rejects(createGuestService(client).save("Alex"));
});

test("an invalid saved identity returns to guest entry", async () => {
  let signedOut = false;
  const client = {
    auth: {
      getSession: async () => ({ data: { session: {} } }),
      getUser: async () => ({ error: { status: 401 } }),
      signOut: async ({ scope }) => {
        assert.equal(scope, "local");
        signedOut = true;
        return {};
      },
    },
  };
  assert.equal(await createGuestService(client).restore(), null);
  assert.ok(signedOut);
});

test("solo player names and preferences use game-owned storage keys", () => {
  const values = new Map([["game-hub-auth", "existing identity"]]);
  vi.stubGlobal("localStorage", {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  });
  assert.equal(savePlayerName("  Écho  "), "Écho");
  assert.equal(localPlayerName(), "Écho");
  writeSetting("settings", { volume: 0.4 });
  assert.deepEqual(readSetting("settings", {}), { volume: 0.4 });
  assert.deepEqual(
    [...values.keys()],
    ["game-hub-auth", "cs-web:player-name", "cs-web:settings"],
  );
  assert.equal(values.get("game-hub-auth"), "existing identity");
  assert.throws(() => savePlayerName(" "));
  assert.equal(localPlayerName(), "Écho");
});

test("private browsing and corrupted preferences still allow solo play", () => {
  vi.stubGlobal("localStorage", {
    getItem: () => "{",
    setItem: () => {
      throw new Error("Storage unavailable");
    },
  });
  assert.equal(readSetting("settings", "default"), "default");
  writeSetting("settings", {});
  assert.equal(savePlayerName("Echo"), "Echo");
  vi.stubGlobal("localStorage", {
    getItem() {
      throw new Error("Storage unavailable");
    },
  });
  assert.equal(localPlayerName(), "Player");
});

test("room links clean both aliases without losing the map or static entry path", () => {
  const replaceState = vi.fn();
  vi.stubGlobal("history", { state: null, replaceState });
  const path = "http://127.0.0.1:4175/cs-web/";
  const uuid = "ea3c9575-1563-4a71-913e-89bbbffab7d5";
  vi.stubGlobal("window", {
    location: {
      href: path + "?room=invalid&map=mirage&lobby=" + uuid + "#info",
    },
  });
  assert.match(consumeRoomRequest(), /Shared rooms/);
  assert.deepEqual(replaceState.mock.lastCall, [
    null,
    "",
    "/cs-web/?map=mirage#info",
  ]);
  window.location.href = path + "?room=wrong";
  assert.match(consumeRoomRequest(), /invalid/);
  window.location.href = path;
  assert.equal(consumeRoomRequest(), null);
});
