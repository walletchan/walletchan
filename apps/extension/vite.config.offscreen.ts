import { defineConfig, type Plugin } from "vite";
import path from "path";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import { sharedConfig, sharedBuildConfig, buildDir } from "./vite.config";

const hardwareOffscreenCspBoundary = (): Plugin => ({
  name: "hardware-offscreen-csp-boundary",
  enforce: "post",
  generateBundle(_options, bundle) {
    const offscreen = Object.values(bundle).find(
      (entry) =>
        entry.type === "chunk" && entry.fileName === "offscreen.js",
    );
    if (!offscreen || offscreen.type !== "chunk") {
      this.error("Missing hardware offscreen bundle");
    }
    const forbiddenMarkers = [
      "new Function(",
      'Function("return this',
      "(void 0, eval)",
      "https://data.trezor.io/connect/log",
      "trezor-user-env",
      "10.0.0-alpha",
    ];
    for (const marker of forbiddenMarkers) {
      if (offscreen.code.includes(marker)) {
        this.error(
          `Dynamic code leaked into the hardware offscreen bundle: ${marker}`,
        );
      }
    }
  },
});

export default defineConfig({
  ...sharedConfig,
  resolve: {
    ...sharedConfig.resolve,
    alias: {
      ...sharedConfig.resolve.alias,
      // The default reflect-metadata compatibility build contains dynamic-code
      // fallbacks for engines without globalThis. MV3 Chromium always has the
      // required modern globals, so use the package's official CSP-safe entry.
      "reflect-metadata": "reflect-metadata/lite",
    },
  },
  plugins: [
    // Keycard ShellJS frames APDUs with Node's Buffer.
    nodePolyfills({ include: ["buffer"], globals: { Buffer: true, global: false, process: false } }),
    hardwareOffscreenCspBoundary(),
  ],
  build: {
    ...sharedBuildConfig,
    outDir: `${buildDir}/static/js`,
    emptyOutDir: false,
    lib: {
      formats: ["es"],
      entry: path.resolve(__dirname, "src/offscreen/offscreen.ts"),
    },
    rollupOptions: {
      output: { entryFileNames: "offscreen.js", inlineDynamicImports: true },
    },
  },
  publicDir: false,
});
