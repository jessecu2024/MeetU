import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import fs from 'node:fs';
import path from 'path';

/** Copy electron/preload.cjs → dist-electron/preload.cjs (already CJS, no build needed) */
function copyPreload(): Plugin {
  const src = path.resolve(__dirname, 'electron/preload.cjs');
  const dest = path.resolve(__dirname, 'dist-electron/preload.cjs');

  function doCopy() {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }

  return {
    name: 'copy-preload',
    buildStart() {
      doCopy();
    },
    handleHotUpdate({ file }) {
      if (path.resolve(file) === src) {
        doCopy();
      }
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    copyPreload(),
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron', 'better-sqlite3', 'electron-store', 'ws', 'bufferutil', 'utf-8-validate'],
            },
          },
        },
      },
    ]),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@electron': path.resolve(__dirname, 'electron'),
    },
  },
});
