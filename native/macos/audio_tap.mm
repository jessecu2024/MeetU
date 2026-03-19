// ============================================================
// N-API Bridge for ScreenCaptureKit (macOS 13+)
// Objective-C++ bridge between Swift ScreenCaptureKit and Node.js
//
// NOTE: Placeholder — compile on macOS only.
// Build: node-gyp rebuild
// ============================================================

#include <napi.h>

// TODO: Implement N-API bindings that call Swift AudioCaptureDelegate
// This will expose:
//   - nativeStartCapture(callback) → starts ScreenCaptureKit audio capture
//   - nativeStopCapture() → stops capture
//   - The callback receives PCM audio buffers

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    // Placeholder — will be implemented when testing on macOS
    exports.Set("available", Napi::Boolean::New(env, false));
    return exports;
}

NODE_API_MODULE(screencapture, Init)
