import { defineConfig, loadEnv, type Plugin } from "vite";
import path from "path";
import { minify as minifyJavaScript } from "terser";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import tsconfigPaths from "vite-tsconfig-paths";
import { sharedConfig, sharedBuildConfig, buildDir } from "./vite.config";
import { compactBackground } from "./scripts/build/compactBackground";

const isFirefox = process.env.BROWSER === "firefox";

const firefoxTrezorBoundary = (): Plugin => {
  const unavailable = path.resolve(
    __dirname,
    "src/chrome/trezor/firefoxUnavailable.ts",
  );
  const authorityModules = new Set(
    [
      "src/chrome/trezor/accountHandlers.ts",
      "src/chrome/trezor/offscreenBridge.ts",
      "src/chrome/trezor/operationId.ts",
      "src/chrome/trezor/connectClient.ts",
      "src/chrome/trezor/connectSdk.ts",
      "src/chrome/trezor/connectAdapter.ts",
      "src/chrome/trezor/session.ts",
      "src/chrome/trezor/signing.ts",
      "src/chrome/background/trezorRouter.ts",
    ].map((relativePath) => path.resolve(__dirname, relativePath)),
  );

  return {
    name: "firefox-trezor-release-boundary",
    enforce: "pre",
    resolveId(source, importer) {
      if (!isFirefox || !importer || !source.startsWith(".")) return null;
      const cleanImporter = importer.split("?")[0];
      const candidate = path.resolve(path.dirname(cleanImporter), source);
      const withExtension = path.extname(candidate) ? candidate : `${candidate}.ts`;
      return authorityModules.has(withExtension) ? unavailable : null;
    },
    generateBundle(_options, bundle) {
      if (!isFirefox) return;
      const background = Object.values(bundle).find(
        (entry) => entry.type === "chunk" && entry.fileName === "background.js",
      );
      if (!background || background.type !== "chunk") {
        this.error("Missing Firefox background bundle");
      }
      for (const marker of [
        "https://connect.trezor.io",
        "https://suite.trezor.io",
        "ws://127.0.0.1:21335",
        "offscreen:trezor",
        "walletchan-trezor-connect",
      ]) {
        if (background.code.includes(marker)) {
          this.error(`Trezor transport leaked into Firefox background: ${marker}`);
        }
      }
    },
  };
};

const trezorServiceWorkerBoundary = (): Plugin => ({
  name: "trezor-service-worker-boundary",
  enforce: "post",
  generateBundle(_options, bundle) {
    if (isFirefox) return;
    for (const entry of Object.values(bundle)) {
      if (entry.type !== "chunk") continue;
      for (const [id, rendered] of Object.entries(entry.modules)) {
        // The thin client has no use for the ambiguously licensed crypto-utils
        // barrel re-export. Fail release builds if a future SDK retains it.
        if (id.includes("/@trezor/crypto-utils/") && rendered.renderedLength > 0) {
          this.error("Trezor crypto-utils code entered the background bundle; review its license before distribution.");
        }
      }
      for (const marker of ["new Function(", 'Function("return this', "(void 0, eval)", "https://data.trezor.io/connect/log"]) {
        if (entry.code.includes(marker)) this.error(`Unsafe SDK code entered the background bundle: ${marker}`);
      }
    }
  },
});

const privacySdkServiceWorkerBoundary = (): Plugin => ({
  name: "privacy-sdk-service-worker-boundary",
  enforce: "post",
  generateBundle(_options, bundle) {
    const background = Object.values(bundle).find(
      (entry) => entry.type === "chunk" && entry.fileName === "background.js",
    );
    if (!background || background.type !== "chunk") {
      this.error("Missing background service-worker bundle");
    }
    const forbiddenMarkers = [
      "curve_bn128",
      "URL.createObjectURL(workerBlob)",
      "The nonce must be less than 2 ^ 128",
    ];
    for (const marker of forbiddenMarkers) {
      if (background.code.includes(marker)) {
        this.error(
          `Privacy Pools prover/worker code leaked into background.js: ${marker}`,
        );
      }
    }
  },
});

const compactGeneratedBackground = (): Plugin => ({
  name: "compact-generated-background",
  enforce: "post",
  async renderChunk(code, chunk) {
    if (chunk.fileName !== "background.js") return null;
    const result = await minifyJavaScript(code, {
      compress: false,
      mangle: false,
      module: !isFirefox,
      format: { comments: false },
    });
    if (!result.code) this.error("Background syntax compaction produced no code");
    return { code: result.code, map: null };
  },
});

export default defineConfig(({ mode }) => {
  const extensionEnv = loadEnv(mode, __dirname, "");
  const websiteEnv = loadEnv(
    mode,
    path.resolve(__dirname, "../website"),
    "NEXT_PUBLIC_",
  );
  const defillamaSearchKey =
    process.env.VITE_DEFILLAMA_SEARCH_KEY ||
    process.env.NEXT_PUBLIC_DEFILLAMA_SEARCH_KEY ||
    websiteEnv.NEXT_PUBLIC_DEFILLAMA_SEARCH_KEY ||
    "";
  const theGraphApiKey =
    process.env.VITE_THE_GRAPH_API_KEY ||
    process.env.NEXT_PUBLIC_THE_GRAPH_API_KEY ||
    extensionEnv.VITE_THE_GRAPH_API_KEY ||
    extensionEnv.NEXT_PUBLIC_THE_GRAPH_API_KEY ||
    websiteEnv.NEXT_PUBLIC_THE_GRAPH_API_KEY ||
    "";

  return {
    ...sharedConfig,
    define: {
      ...sharedConfig.define,
      "import.meta.env.VITE_DEFILLAMA_SEARCH_KEY": JSON.stringify(
        defillamaSearchKey,
      ),
      "import.meta.env.VITE_THE_GRAPH_API_KEY": JSON.stringify(
        theGraphApiKey,
      ),
    },
    resolve: {
      ...sharedConfig.resolve,
      alias: {
        ...sharedConfig.resolve.alias,
        // WalletKit imports its optional Pay client unconditionally. The
        // upstream Pay browser bundle contains dynamic-code/WebAssembly loaders
        // that violate the extension's strict MV3 CSP. WalletChan does not expose
        // Pay, so keep WalletConnect sessions/signing and disable only that
        // optional feature at the background-bundle boundary.
        "@walletconnect/pay": path.resolve(
          __dirname,
          "src/chrome/walletConnect/payUnavailable.ts",
        ),
        // The SDK's published root barrel eagerly bundles snarkjs/ffjavascript.
        // ffjavascript calls URL.createObjectURL at module evaluation time,
        // which is unavailable in a Chrome MV3 service worker. Consume the
        // package's reviewed pure crypto source directly so the background
        // includes the official derivation/hash primitives without prover or
        // worker startup code. The package version and source provenance remain
        // pinned by privacy-pools.protocol.json and the lockfile tests.
        "@0xbow/privacy-pools-core-sdk": path.resolve(
          __dirname,
          "node_modules/@0xbow/privacy-pools-core-sdk/src/crypto.ts",
        ),
        // The SDK's maci-crypto dependency initializes Poseidon constants for
        // every supported width at service-worker startup. Privacy Pools uses
        // only widths 1-3, so bind that exact surface to a vector-checked
        // lightweight implementation and avoid the large eager allocation.
        "maci-crypto/build/ts/hashing.js": path.resolve(
          __dirname,
          "src/chrome/privacy/protocol/poseidonLite.ts",
        ),
      },
    },
    plugins: [
      tsconfigPaths(),
      nodePolyfills({
        exclude: ["console"],
        globals: {
          Buffer: true,
          global: true,
          process: true,
        },
      }),
      ...(mode === "production" ? [compactBackground()] : []),
      privacySdkServiceWorkerBoundary(),
      trezorServiceWorkerBoundary(),
      firefoxTrezorBoundary(),
      compactGeneratedBackground(),
    ],
    build: {
      ...sharedBuildConfig,
      outDir: `${buildDir}/static/js`,
      emptyOutDir: false,
      lib: {
        // Chrome MV3 uses an ES-module service worker. Firefox MV3 event pages
        // load via background.scripts and must be classic scripts (IIFE).
        formats: [isFirefox ? "iife" : "es"],
        entry: path.resolve(__dirname, "src/chrome/background.ts"),
        name: "background",
      },
      rollupOptions: {
        output: {
          entryFileNames: "background.js",
          compact: true,
          // Service workers / event pages disallow dynamic import() — inline
          // everything into a single chunk so no code-splitting occurs.
          inlineDynamicImports: true,
        },
      },
    },
    publicDir: false,
  };
});
