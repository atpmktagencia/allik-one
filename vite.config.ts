// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { fileURLToPath } from "node:url";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import type { NitroConfig } from "nitro/types";

// The Lovable wrapper forwards Nitro options but exposes only a subset in its type.
const nitroOptions = {
  preset: "vercel",
  vercel: { functions: { maxDuration: 240 } },
} satisfies NitroConfig;

export default defineConfig({
  vite: {
    plugins: [
      {
        name: "allik-pdfkit-dev-node-loader",
        // Vite's dev evaluator cannot execute this Browserify CommonJS wrapper.
        // Use native Node loading only in dev; production still bundles its embedded fonts.
        apply: "serve",
        enforce: "pre",
        load(id) {
          if (id.endsWith("/pdfkit/js/pdfkit.standalone.js")) {
            const filename = fileURLToPath(
              new URL("./node_modules/pdfkit/js/pdfkit.standalone.js", import.meta.url),
            );
            return `import { createRequire } from "node:module"; export default createRequire(${JSON.stringify(import.meta.url)})(${JSON.stringify(filename)});`;
          }
          return null;
        },
      },
    ],
  },
  nitro: nitroOptions,
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
