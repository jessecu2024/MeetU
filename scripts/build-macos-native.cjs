#!/usr/bin/env node
// ============================================================
// Build the macOS ScreenCaptureKit N-API addon (native/macos).
//
// Run from `postinstall`. Deliberately NON-FATAL: if the build
// fails (no Xcode CLT, older SDK, offline header fetch, non-macOS
// platform), we log a warning and exit 0 so `npm install` still
// succeeds. The app then runs without the macOS native system-audio
// path — `system-audio:probe` reports it unavailable and the
// renderer falls back to getUserMedia + virtual-cable guidance,
// exactly as a Windows/Linux user already does.
//
// ABI note: the addon is a pure Node-API module (NAPI_VERSION=8 in
// binding.gyp). Node-API is ABI-stable across Node and Electron
// versions, so a single `node-gyp rebuild` against the local Node
// produces a .node that also loads in the Electron 30 main process —
// no separate electron-rebuild pass is required for it.
// ============================================================

'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

if (process.platform !== 'darwin') {
  console.log('[build-macos-native] Not macOS — skipping native ScreenCaptureKit addon.');
  process.exit(0);
}

const nativeDir = path.join(__dirname, '..', 'native', 'macos');
if (!fs.existsSync(path.join(nativeDir, 'binding.gyp'))) {
  console.warn('[build-macos-native] native/macos/binding.gyp missing — skipping.');
  process.exit(0);
}

// Resolve the local node-gyp CLI installed as a devDependency. Falling
// back to a bare 'node-gyp' lets it work if the binary is on PATH
// (npm puts node_modules/.bin on PATH during lifecycle scripts).
let nodeGypBin = 'node-gyp';
try {
  const pkgPath = require.resolve('node-gyp/package.json');
  const pkg = require(pkgPath);
  const binRel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin['node-gyp'];
  nodeGypBin = path.join(path.dirname(pkgPath), binRel);
} catch {
  // keep the PATH-based fallback
}

console.log('[build-macos-native] Building ScreenCaptureKit addon (non-fatal on failure)…');
const result = spawnSync(
  process.execPath,
  [nodeGypBin, 'rebuild'],
  { cwd: nativeDir, stdio: 'inherit' },
);

if (result.status === 0) {
  console.log('[build-macos-native] Built OK — macOS native system audio is available.');
  process.exit(0);
}

console.warn(
  '[build-macos-native] Build failed (exit ' + result.status + '). ' +
  'macOS native system audio will be unavailable; the app falls back to ' +
  'getUserMedia + virtual audio cable. To retry: `npm run build:macos-native`.',
);
// NON-FATAL: do not break `npm install`.
process.exit(0);
