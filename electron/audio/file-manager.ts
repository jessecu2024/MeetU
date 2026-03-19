// ============================================================
// WAV File Manager (Main Process)
// Streams PCM audio data to a WAV file on disk.
// Uses streaming write to support long recordings without
// holding everything in memory.
// ============================================================

import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const SAMPLE_RATE = 16000;
const NUM_CHANNELS = 1;
const BITS_PER_SAMPLE = 16;
const BYTES_PER_SAMPLE = BITS_PER_SAMPLE / 8;

let outputFd: number | null = null;
let outputPath = '';
let totalDataBytes = 0;

/** Get recordings directory, creating it if needed */
function getRecordingsDir(): string {
  const dir = path.join(app.getPath('home'), 'MeetingAI', 'recordings');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Generate recording filename: meeting_YYYY-MM-DD_HHmmss.wav */
function generateFilename(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `meeting_${date}_${time}.wav`;
}

/** Write a placeholder WAV header (44 bytes). Sizes will be patched on close. */
function writeWavHeader(fd: number): void {
  const header = Buffer.alloc(44);

  // RIFF chunk
  header.write('RIFF', 0);
  header.writeUInt32LE(0, 4); // placeholder for file size - 8
  header.write('WAVE', 8);

  // fmt sub-chunk
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // sub-chunk size
  header.writeUInt16LE(1, 20);  // PCM format
  header.writeUInt16LE(NUM_CHANNELS, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * NUM_CHANNELS * BYTES_PER_SAMPLE, 28); // byte rate
  header.writeUInt16LE(NUM_CHANNELS * BYTES_PER_SAMPLE, 32); // block align
  header.writeUInt16LE(BITS_PER_SAMPLE, 34);

  // data sub-chunk
  header.write('data', 36);
  header.writeUInt32LE(0, 40); // placeholder for data size

  fs.writeSync(fd, header);
}

/** Patch the WAV header with correct sizes */
function patchWavHeader(fd: number, dataBytes: number): void {
  const fileSizeMinus8 = Buffer.alloc(4);
  fileSizeMinus8.writeUInt32LE(36 + dataBytes);
  fs.writeSync(fd, fileSizeMinus8, 0, 4, 4);

  const dataSizeBuffer = Buffer.alloc(4);
  dataSizeBuffer.writeUInt32LE(dataBytes);
  fs.writeSync(fd, dataSizeBuffer, 0, 4, 40);
}

// ── Public API ──

/** Start a new recording. Returns the file path. */
export function startRecording(): string {
  if (outputFd !== null) {
    stopRecording();
  }

  const dir = getRecordingsDir();
  outputPath = path.join(dir, generateFilename());
  outputFd = fs.openSync(outputPath, 'w');
  totalDataBytes = 0;
  writeWavHeader(outputFd);

  console.log(`[FileManager] Recording started: ${outputPath}`);
  return outputPath;
}

/**
 * Append a PCM audio chunk.
 * Expects Int16 PCM data as an ArrayBuffer or Buffer.
 */
export function appendChunk(chunk: ArrayBuffer | Buffer): void {
  if (outputFd === null) return;

  const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  fs.writeSync(outputFd, buffer);
  totalDataBytes += buffer.byteLength;
}

/**
 * Append Float32 PCM data (from Web Audio API).
 * Converts to Int16 PCM before writing.
 */
export function appendFloat32Chunk(float32Data: ArrayBuffer): void {
  if (outputFd === null) return;

  const floats = new Float32Array(float32Data);
  const int16 = Buffer.alloc(floats.length * 2);

  for (let i = 0; i < floats.length; i++) {
    // Clamp and convert float32 [-1, 1] to int16 [-32768, 32767]
    const s = Math.max(-1, Math.min(1, floats[i]));
    int16.writeInt16LE(s < 0 ? s * 0x8000 : s * 0x7FFF, i * 2);
  }

  fs.writeSync(outputFd, int16);
  totalDataBytes += int16.byteLength;
}

/** Stop recording and finalize the WAV file. Returns the file path. */
export function stopRecording(): string {
  if (outputFd === null) return '';

  patchWavHeader(outputFd, totalDataBytes);
  fs.closeSync(outputFd);

  const filePath = outputPath;
  console.log(`[FileManager] Recording saved: ${filePath} (${(totalDataBytes / 1024).toFixed(1)} KB)`);

  outputFd = null;
  outputPath = '';
  totalDataBytes = 0;

  return filePath;
}

/** Check if currently recording */
export function isRecording(): boolean {
  return outputFd !== null;
}

/** Get the recordings directory path */
export function getRecordingsPath(): string {
  return getRecordingsDir();
}
