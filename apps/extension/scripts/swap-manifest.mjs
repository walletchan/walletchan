#!/usr/bin/env node
// Post-build manifest swap for the Firefox build.
//
// Vite copies `public/manifest.json` (the Chrome manifest) into the build
// output. For the Firefox build, this script overwrites the resulting
// `manifest.json` with the Firefox variant kept at
// `apps/extension/manifest.firefox.json` (deliberately stored OUTSIDE
// public/ so it never leaks into the Chrome build).
//
// Invoke with the build directory as the only argument:
//   node scripts/swap-manifest.mjs build-firefox

import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { cwd, exit } from "node:process";

const buildDir = process.argv[2];
if (!buildDir) {
  console.error("swap-manifest: missing build dir argument");
  exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(here, "..");
const firefoxManifest = resolve(extensionRoot, "manifest.firefox.json");
const targetManifest = resolve(cwd(), buildDir, "manifest.json");

if (!existsSync(firefoxManifest)) {
  console.error(`swap-manifest: ${firefoxManifest} not found`);
  exit(1);
}

if (!existsSync(targetManifest)) {
  console.error(`swap-manifest: ${targetManifest} not found (was build run?)`);
  exit(1);
}

writeFileSync(targetManifest, readFileSync(firefoxManifest, "utf8"));
const chromeOnlyTrezorFiles = [
  "offscreen.html",
  "trezor-symbol.svg",
  "trezor-usb-permissions.html",
  "trezor-wordmark.svg",
  "vendor/trezor/content-script.js",
  "vendor/trezor/usb-permissions.js",
];
for (const relativePath of chromeOnlyTrezorFiles) {
  rmSync(resolve(cwd(), buildDir, relativePath), { force: true });
}
const trezorVendorDirectory = resolve(cwd(), buildDir, "vendor/trezor");
rmSync(trezorVendorDirectory, { force: true, recursive: true });
const vendorDirectory = resolve(cwd(), buildDir, "vendor");
if (existsSync(vendorDirectory) && readdirSync(vendorDirectory).length === 0) {
  rmSync(vendorDirectory, { force: true, recursive: true });
}

const forbiddenTrezorMarkers = [
  "https://connect.trezor.io",
  "https://suite.trezor.io",
  "ws://127.0.0.1:21335",
  "offscreen:trezor",
  "walletchan-trezor-connect",
];
const pendingDirectories = [resolve(cwd(), buildDir)];
while (pendingDirectories.length) {
  const directory = pendingDirectories.pop();
  for (const name of readdirSync(directory)) {
    const target = resolve(directory, name);
    if (statSync(target).isDirectory()) {
      pendingDirectories.push(target);
      continue;
    }
    if (!target.endsWith(".js")) continue;
    const source = readFileSync(target, "utf8");
    for (const marker of forbiddenTrezorMarkers) {
      if (source.includes(marker)) {
        console.error(
          `swap-manifest: Trezor transport marker remained in Firefox: ${marker}`,
        );
        exit(1);
      }
    }
  }
}
console.log(`swap-manifest: ${buildDir}/manifest.json now = Firefox variant`);
