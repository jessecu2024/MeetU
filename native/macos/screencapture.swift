// ============================================================
// ScreenCaptureKit Audio Capture (macOS 13+)
// N-API addon to capture system audio via Apple's ScreenCaptureKit
//
// NOTE: This is a placeholder. Must be compiled on macOS with:
//   swiftc -framework ScreenCaptureKit -framework CoreAudio ...
//
// The actual integration will use node-gyp to build a .node addon
// that exposes start/stop/onAudioChunk to the Electron main process.
// ============================================================

import Foundation
import ScreenCaptureKit
import CoreAudio

/// Audio capture delegate for ScreenCaptureKit
@available(macOS 13.0, *)
class AudioCaptureDelegate: NSObject, SCStreamDelegate, SCStreamOutput {
    var onAudioBuffer: ((Data) -> Void)?

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio else { return }

        // Extract audio data from CMSampleBuffer
        guard let blockBuffer = CMSampleBufferGetDataBuffer(sampleBuffer) else { return }
        var length = 0
        var dataPointer: UnsafeMutablePointer<Int8>?
        CMBlockBufferGetDataPointer(blockBuffer, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: &length, dataPointerOut: &dataPointer)

        guard let ptr = dataPointer else { return }
        let data = Data(bytes: ptr, count: length)
        onAudioBuffer?(data)
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        print("[ScreenCaptureKit] Stream stopped with error: \(error)")
    }
}

/// Main capture controller
@available(macOS 13.0, *)
class SystemAudioCapture {
    private var stream: SCStream?
    private var delegate = AudioCaptureDelegate()

    /// Start capturing system audio
    func start(onAudioChunk: @escaping (Data) -> Void) async throws {
        delegate.onAudioBuffer = onAudioChunk

        // Get shareable content
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)

        // Get the main display
        guard let display = content.displays.first else {
            throw NSError(domain: "ScreenCapture", code: 1, userInfo: [NSLocalizedDescriptionKey: "No displays found"])
        }

        // Configure for audio-only capture
        let config = SCStreamConfiguration()
        config.capturesAudio = true
        config.sampleRate = 16000
        config.channelCount = 1

        // Minimize video overhead (we only want audio)
        config.width = 2
        config.height = 2
        config.minimumFrameInterval = CMTime(value: 1, timescale: 1) // 1 FPS minimum

        // Create content filter for the display
        let filter = SCContentFilter(display: display, excludingWindows: [])

        // Create and start stream
        stream = SCStream(filter: filter, configuration: config, delegate: delegate)
        try stream?.addStreamOutput(delegate, type: .audio, sampleHandlerQueue: .global(qos: .userInteractive))
        try await stream?.startCapture()

        print("[ScreenCaptureKit] Audio capture started")
    }

    /// Stop capturing
    func stop() async throws {
        try await stream?.stopCapture()
        stream = nil
        print("[ScreenCaptureKit] Audio capture stopped")
    }
}

// ============================================================
// N-API Bridge (placeholder)
// In production, this would be a C++/ObjC++ bridge using:
//   #include <napi.h>
// to expose start/stop/onAudioChunk as JavaScript functions.
//
// The binding.gyp would configure:
//   - Swift compilation flags
//   - ScreenCaptureKit framework linking
//   - Node.js N-API headers
//
// See native/macos/binding.gyp for build configuration.
// ============================================================
