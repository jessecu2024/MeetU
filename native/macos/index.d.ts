// TypeScript types for the macOS ScreenCaptureKit N-API loader.
// Mirrors the shape exported by index.cjs and the underlying
// audio_tap.mm N-API surface. The TS compiler can pick this up
// via createRequire-style imports from electron/audio/macos-native-capture.ts.

export interface ApplicationEntry {
  /** Operating-system process ID. Used as the unique handle when starting per-app capture. */
  pid: number;
  /** Display name from the macOS application bundle. May be empty if the running app is unnamed. */
  name: string;
  /** Reverse-DNS bundle identifier (e.g. `us.zoom.xos`). Stable across launches; may be empty. */
  bundleId: string;
}

export interface StartOptions {
  /**
   * Process ID of the application to capture. Omit (or pass 0)
   * to capture the entire system audio mix.
   */
  pid?: number;
  /**
   * Audio callback. Receives a Float32Array of 16-kHz mono PCM
   * samples. The cadence depends on the ScreenCaptureKit
   * scheduling and the internal resampler (typically ~10-20 ms
   * per callback at steady state).
   */
  onAudio: (samples: Float32Array) => void;
  /**
   * Fatal-error callback. Fires if the SCStream stops itself
   * after start() succeeded (permission revoked mid-session,
   * target app quit, etc.). The capture is dead at this point;
   * the caller should run stop() and surface the error to the
   * user.
   */
  onError: (err: { message: string; code: number }) => void;
}

export type AvailableLoader =
  | {
      available: true;
      start(opts: StartOptions): Promise<void>;
      stop(): Promise<void>;
      listApplications(): Promise<ApplicationEntry[]>;
    }
  | {
      available: false;
      reason: string;
    };

declare const loader: AvailableLoader;
export default loader;
