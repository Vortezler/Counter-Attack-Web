import { readFileSync, readdirSync } from "node:fs";
import { it, expect } from "vitest";

// Vite concatenates every stylesheet into one bundle, so an unclosed block in
// one file swallows the rules of every file after it (this broke the lobby once).
const dir = new URL("../src/", import.meta.url);
it.each(readdirSync(dir).filter((f) => f.endsWith(".css")))(
  "%s has balanced braces",
  (file) => {
    const css = readFileSync(new URL(file, dir), "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    let depth = 0;
    for (const ch of css) {
      if (ch === "{") depth++;
      if (ch === "}") depth--;
      expect(depth).toBeGreaterThanOrEqual(0);
    }
    expect(depth).toBe(0);
  },
);
