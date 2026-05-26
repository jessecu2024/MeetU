// ============================================================
// Loader for the macOS ScreenCaptureKit N-API addon.
//
// Used by electron/audio/macos-native-capture.ts. Lives as
// CommonJS so the require() shape matches node-gyp's
// build/Release/<name>.node output exactly — same convention as
// better-sqlite3 and most other native modules. Importing from
// TypeScript via createRequire works fine.
//
// The loader is deliberately tolerant of every failure mode:
//
//   - addon not built yet (developer didn't run postinstall on a
//     macOS box, or postinstall failed silently)
//   - addon built against a different SDK / Node ABI than the
//     current Electron process (.node binary refuses to load)
//   - running on a non-darwin platform (the .node was committed
//     by accident, or the consumer is in a CI image)
//
// In every case we return { available: false, reason }. The
// caller (electron/audio/macos-native-capture.ts) treats this
// as the signal that the native macOS path is unavailable and
// falls back to the existing getUserMedia + virtual-cable
// guidance, exactly as a Linux / older-macOS / Windows user
// already does.
// ============================================================

'use strict';

const path = require('node:path');

function unavailable(reason) {
  return { available: false, reason };
}

if (process.platform !== 'darwin') {
  module.exports = unavailable(
    `Native macOS capture is only built on darwin (current platform: ${process.platform})`,
  );
  return;
}

const binaryPath = path.join(__dirname, 'build', 'Release', 'meetu_screencapture.node');

let addon;
try {
  addon = require(binaryPath);
} catch (err) {
  module.exports = unavailable(
    `Could not load ${binaryPath}: ${err && err.message ? err.message : err}. ` +
    `Run \`npm rebuild\` (or build the addon manually: \`node-gyp rebuild --directory=native/macos\`).`,
  );
  return;
}

if (!addon || typeof addon !== 'object') {
  module.exports = unavailable('Native addon returned a non-object — module init failed');
  return;
}

if (!addon.available) {
  module.exports = unavailable(
    addon.reason || 'Native addon reported available=false (running on macOS < 13, or built without ScreenCaptureKit headers)',
  );
  return;
}

module.exports = {
  available: true,
  start: addon.start,
  stop: addon.stop,
  listApplications: addon.listApplications,
};
