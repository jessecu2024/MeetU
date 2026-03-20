// ============================================================
// Audio File Manager (Main Process)
// Streams webm/opus audio chunks to a file on disk.
// ============================================================

import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

let outputFd: number | null = null;
let outputPath = '';
let totalDataBytes = 0;

function getRecordingsDir(): string {
  const dir = path.join(app.getPath('home'), 'MeetingAI', 'recordings');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function generateFilename(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `meeting_${date}_${time}.webm`;
}

export function startRecording(): string {
  if (outputFd !== null) stopRecording();

  const dir = getRecordingsDir();
  outputPath = path.join(dir, generateFilename());
  outputFd = fs.openSync(outputPath, 'w');
  totalDataBytes = 0;

  console.log(`[FileManager] Recording started: ${outputPath}`);
  return outputPath;
}

/** Append raw audio chunk (webm/opus bytes) */
export function appendChunk(chunk: ArrayBuffer | Buffer): void {
  if (outputFd === null) return;
  const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  fs.writeSync(outputFd, buffer);
  totalDataBytes += buffer.byteLength;
}

/** Legacy: convert Float32 to Int16 and append. Kept for mock-capture compat. */
export function appendFloat32Chunk(float32Data: ArrayBuffer): void {
  if (outputFd === null) return;
  const floats = new Float32Array(float32Data);
  const int16 = Buffer.alloc(floats.length * 2);
  for (let i = 0; i < floats.length; i++) {
    const s = Math.max(-1, Math.min(1, floats[i]));
    int16.writeInt16LE(s < 0 ? s * 0x8000 : s * 0x7FFF, i * 2);
  }
  fs.writeSync(outputFd, int16);
  totalDataBytes += int16.byteLength;
}

export function stopRecording(): string {
  if (outputFd === null) return '';
  fs.closeSync(outputFd);

  const filePath = outputPath;
  console.log(`[FileManager] Recording saved: ${filePath} (${(totalDataBytes / 1024).toFixed(1)} KB)`);

  outputFd = null;
  outputPath = '';
  totalDataBytes = 0;
  return filePath;
}

export function isRecording(): boolean {
  return outputFd !== null;
}

export function getRecordingsPath(): string {
  return getRecordingsDir();
}
