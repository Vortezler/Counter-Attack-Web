import { test } from "vitest";
import assert from "node:assert/strict";
import {
  validateClientConfig,
  securityMeta,
} from "../scripts/security-policy.mjs";

test("private keys and user session tokens cannot enter a frontend build", () => {
  const url = "https://example.supabase.co";
  for (const key of [
    "sb_secret_do_not_bundle",
    `e30.${Buffer.from('{"role":"service_role"}').toString("base64url")}.sig`,
    `e30.${Buffer.from('{"role":"authenticated"}').toString("base64url")}.sig`,
  ]) {
    assert.throws(() => validateClientConfig(url, key));
  }
  assert.equal(validateClientConfig(url, "sb_publishable_example").origin, url);
  assert.equal(validateClientConfig(undefined, undefined), null);
});

test("backend URLs reject embedded credentials and insecure hosted endpoints", () => {
  for (const url of [
    "https://user:password@example.com",
    "http://example.com",
    "https://example.com/?token=secret",
    "javascript:alert(1)",
  ]) {
    assert.throws(() => validateClientConfig(url, "sb_publishable_example"));
  }
  assert.ok(
    validateClientConfig("http://127.0.0.1:54321", "sb_publishable_example"),
  );
});

test("script policy hashes the bootstrap rather than allowing arbitrary inline scripts", () => {
  const [meta] = securityMeta(
    '<script>document.documentElement.dataset.theme="dark";</script>',
    new URL("https://example.supabase.co"),
  );
  assert.match(
    meta.attrs.content,
    /script-src 'self' 'wasm-unsafe-eval' 'sha256-/,
  );
  assert.ok(!meta.attrs.content.includes("'unsafe-eval'"));
  assert.match(
    meta.attrs.content,
    /connect-src 'self' https:\/\/example.supabase.co wss:\/\/example.supabase.co/,
  );
  assert.ok(
    !meta.attrs.content
      .split(";")
      .find((part) => part.includes("script-src"))
      .includes("unsafe-inline"),
  );
});
