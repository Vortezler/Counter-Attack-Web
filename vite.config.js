import { defineConfig, loadEnv } from "vite";
import {
  securityMeta,
  validateClientConfig,
} from "./scripts/security-policy.mjs";
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const backend = validateClientConfig(
    env.VITE_SUPABASE_URL,
    env.VITE_SUPABASE_PUBLISHABLE_KEY,
  );
  return {
    base: env.VITE_BASE_PATH || "/cs-web/",
    build: { license: true },
    server: {
      host: "127.0.0.1",
      port: 5177,
      strictPort: true,
      watch: { ignored: ["**/.qa/**", "**/test-results/**", "**/docs/**"] },
    },
    preview: { host: "127.0.0.1", port: 4177 },
    plugins: [
      {
        name: "browser-security-policy",
        transformIndexHtml: {
          order: "post",
          handler: (html) =>
            securityMeta(html, backend, command === "serve" ? 5177 : null),
        },
      },
    ],
  };
});
