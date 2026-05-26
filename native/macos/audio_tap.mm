// ============================================================
// MeetU macOS ScreenCaptureKit N-API addon (Objective-C++)
//
// Exposes three async N-API functions to the Electron main process:
//
//   listApplications() -> Promise<Array<{ pid, name, bundleId }>>
//     Returns the SCShareableContent applications list. Renderer
//     can use this to populate a per-app picker; bundleId is the
//     stable key, pid is informational.
//
//   start({ pid?, jsCallback, errorCallback }) -> Promise<void>
//     Begin capturing audio. If `pid` is set, capture only that
//     application; otherwise capture the entire system output.
//     jsCallback fires for every audio packet with a Float32Array
//     buffer (mono, 16 kHz, deinterleaved). errorCallback fires
//     if the underlying SCStream fails after start succeeded.
//
//   stop() -> Promise<void>
//     Tear down the stream. Safe to call when not running.
//
// The audio path:
//   SCStream -> CMSampleBuffer (canonical mono Float32 PCM)
//             -> linear resample to 16 kHz
//             -> ThreadSafeFunction -> renderer subscriber
//
// Why this exists: Electron 30's `setDisplayMediaRequestHandler`
// + audio:'loopback' is Windows-only (per Electron typedef). On
// macOS we go through ScreenCaptureKit directly via a native
// module — same Apple API the Electron wrapper would have used,
// but we bind it from N-API ourselves so it actually works on
// macOS 13+ and so we can use SCContentFilter(applications:)
// for per-app capture (the unique feature this native path
// brings).
//
// Compile guard: the entire ScreenCaptureKit-touching surface
// only compiles on macOS 13+. Older SDK builds (or non-Apple
// builds) get a stub that reports `available: false`.
// ============================================================

#include <napi.h>
#include <atomic>
#include <memory>
#include <mutex>
#include <vector>

#if defined(__APPLE__) && (defined(__MAC_OS_X_VERSION_MAX_ALLOWED) && __MAC_OS_X_VERSION_MAX_ALLOWED >= 130000)
  #define MEETU_HAS_SCK 1
#else
  #define MEETU_HAS_SCK 0
#endif

#if MEETU_HAS_SCK

#import <Foundation/Foundation.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <CoreMedia/CoreMedia.h>
#import <AVFoundation/AVFoundation.h>

// Forward decls. API_AVAILABLE is only valid on an interface /
// protocol / implementation definition, not on a `@class` forward
// declaration — Apple clang rejects that combination.
@class MeetUAudioCapture;

namespace meetu {

// ── Shared state ────────────────────────────────────────────
// One global capture instance is enough: the renderer can only
// be recording one session at a time, and SCStream is heavy.
// Guarded by a mutex so start/stop from different JS calls
// don't race the Objective-C lifecycle.

struct Globals {
  std::mutex mutex;
  MeetUAudioCapture* capture API_AVAILABLE(macos(13.0)) = nil;
  // ThreadSafeFunction lives for the duration of one capture
  // session — owned by start() and released by stop() so the
  // N-API runtime can quit cleanly even if JS holds no
  // references.
  Napi::ThreadSafeFunction tsfnAudio;
  Napi::ThreadSafeFunction tsfnError;
  std::atomic<bool> running{false};
};

static Globals& globals() {
  static Globals g;
  return g;
}

// PCM frame delivered from the SCStream audio queue to JS.
// Allocated on the audio thread, freed on the JS thread when
// the TSFN finalize callback runs.
struct AudioFrame {
  std::vector<float> samples; // mono, 16 kHz
};

struct ErrorPayload {
  std::string message;
  int code;
};

} // namespace meetu

// ── Objective-C capture delegate ────────────────────────────

API_AVAILABLE(macos(13.0))
@interface MeetUAudioCapture : NSObject <SCStreamDelegate, SCStreamOutput>
@property (nonatomic, strong, nullable) SCStream* stream;
@property (nonatomic, assign) double sourceSampleRate; // typically 48000
@property (nonatomic, assign) double targetSampleRate; // 16000
@property (nonatomic, assign) double resamplePhase;    // index into the merged buffer for next pick
@property (nonatomic, strong) NSMutableData* carryBuffer; // un-consumed Float32 samples from previous frames
@end

@implementation MeetUAudioCapture

- (instancetype)init {
  if ((self = [super init])) {
    _targetSampleRate = 16000.0;
    _sourceSampleRate = 48000.0; // default; the real value comes from the buffer's format
    _resamplePhase = 0.0;
    _carryBuffer = [NSMutableData data];
  }
  return self;
}

// SCStreamOutput: called on the audio sample queue for every
// audio packet. The format is canonical AudioStreamBasicDescription
// from ScreenCaptureKit: Float32, mono (we configured channelCount=1),
// non-interleaved at the device's native sample rate (typically
// 48 kHz on Apple Silicon). We resample to 16 kHz Float32 mono
// here and ship the result to JS via the TSFN.
- (void)stream:(SCStream*)stream didOutputSampleBuffer:(CMSampleBufferRef)sampleBuffer ofType:(SCStreamOutputType)type {
  if (type != SCStreamOutputTypeAudio) return;
  if (!CMSampleBufferIsValid(sampleBuffer)) return;

  // Pull the format. SCStream gives us an AudioStreamBasicDescription
  // pointer via CMAudioFormatDescription.
  CMFormatDescriptionRef fmt = CMSampleBufferGetFormatDescription(sampleBuffer);
  if (!fmt) return;
  const AudioStreamBasicDescription* asbd = CMAudioFormatDescriptionGetStreamBasicDescription(fmt);
  if (!asbd) return;
  if (asbd->mSampleRate > 0) self.sourceSampleRate = asbd->mSampleRate;

  // Pull the AudioBufferList. SCStream delivers float32 mono in
  // the first buffer when we set channelCount=1 in the stream config.
  size_t blockSize = 0;
  AudioBufferList abl;
  CMBlockBufferRef block = nullptr;
  OSStatus st = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
    sampleBuffer,
    &blockSize,
    &abl,
    sizeof(abl),
    /*blockBufferAllocator*/ nullptr,
    /*blockBufferMemoryAllocator*/ nullptr,
    /*flags*/ 0,
    &block
  );
  if (st != noErr || abl.mNumberBuffers == 0) {
    if (block) CFRelease(block);
    return;
  }
  AudioBuffer* buf = &abl.mBuffers[0];
  const float* src = static_cast<const float*>(buf->mData);
  const NSUInteger srcCount = buf->mDataByteSize / sizeof(float);
  if (!src || srcCount == 0) {
    if (block) CFRelease(block);
    return;
  }

  // Concatenate with carry buffer (samples we didn't consume last
  // frame because the resample phase fell past the end). This is
  // the same carry-buffer pattern as the AudioWorklet resampler
  // in src/services/audio/pcm-worklet.ts.
  const NSUInteger carryCount = self.carryBuffer.length / sizeof(float);
  std::vector<float> merged;
  merged.reserve(carryCount + srcCount);
  if (carryCount > 0) {
    const float* carryPtr = static_cast<const float*>(self.carryBuffer.bytes);
    merged.insert(merged.end(), carryPtr, carryPtr + carryCount);
  }
  merged.insert(merged.end(), src, src + srcCount);

  if (block) CFRelease(block);

  // Linear decimation to 16 kHz. We pick floor(phase + i*ratio)
  // for i = 0..N and advance phase by ratio each pick. The phase
  // is kept relative to the start of `merged` and reset after
  // dropping the consumed prefix.
  const double ratio = self.sourceSampleRate / self.targetSampleRate;
  std::vector<float> out;
  out.reserve(static_cast<size_t>(merged.size() / ratio) + 1);
  double phase = self.resamplePhase;
  while (true) {
    const size_t idx = static_cast<size_t>(phase);
    if (idx >= merged.size()) break;
    out.push_back(merged[idx]);
    phase += ratio;
  }

  // Save the un-consumed tail as the next carry buffer. Shift
  // phase so it lands in [0, 1) at the start of the new buffer.
  const size_t drop = static_cast<size_t>(phase);
  if (drop < merged.size()) {
    const size_t tailSize = merged.size() - drop;
    [self.carryBuffer setLength:tailSize * sizeof(float)];
    memcpy(self.carryBuffer.mutableBytes, merged.data() + drop, tailSize * sizeof(float));
    self.resamplePhase = phase - static_cast<double>(drop);
  } else {
    [self.carryBuffer setLength:0];
    double newPhase = phase - static_cast<double>(merged.size());
    if (newPhase < 0) newPhase = 0; // numerical safety
    self.resamplePhase = newPhase;
  }

  if (out.empty()) return;

  // Hand off to JS via ThreadSafeFunction. The lambda runs on the
  // JS thread; we own the AudioFrame allocation here.
  auto frame = new meetu::AudioFrame();
  frame->samples = std::move(out);

  auto status = meetu::globals().tsfnAudio.BlockingCall(frame, [](Napi::Env env, Napi::Function jsCallback, meetu::AudioFrame* data) {
    if (env && jsCallback) {
      const size_t byteLen = data->samples.size() * sizeof(float);
      auto buf = Napi::ArrayBuffer::New(env, byteLen);
      memcpy(buf.Data(), data->samples.data(), byteLen);
      auto f32 = Napi::TypedArrayOf<float>::New(env, data->samples.size(), buf, 0, napi_float32_array);
      jsCallback.Call({ f32 });
    }
    delete data;
  });

  // If the queue is full or closed, drop the frame rather than
  // blocking the audio thread. This matches Apple's expectation
  // that SCStream callbacks return promptly.
  if (status != napi_ok) {
    delete frame;
  }
}

- (void)stream:(SCStream*)stream didStopWithError:(NSError*)error {
  // Forward the failure to JS so the renderer can fall back to
  // mock/virtual-cable capture instead of staring at a dead stream.
  auto payload = new meetu::ErrorPayload{
    .message = error.localizedDescription ? std::string(error.localizedDescription.UTF8String) : "unknown",
    .code = static_cast<int>(error.code),
  };
  auto status = meetu::globals().tsfnError.BlockingCall(payload, [](Napi::Env env, Napi::Function jsCallback, meetu::ErrorPayload* data) {
    if (env && jsCallback) {
      auto obj = Napi::Object::New(env);
      obj.Set("message", Napi::String::New(env, data->message));
      obj.Set("code", Napi::Number::New(env, data->code));
      jsCallback.Call({ obj });
    }
    delete data;
  });
  if (status != napi_ok) {
    delete payload;
  }
  meetu::globals().running = false;
}

@end

// ── N-API surface ───────────────────────────────────────────

namespace meetu {

API_AVAILABLE(macos(13.0))
static void startCaptureWithFilter(SCContentFilter* filter, std::function<void(NSError*)> done) {
  auto config = [[SCStreamConfiguration alloc] init];
  config.capturesAudio = YES;
  config.sampleRate = 48000;     // request native; the resampler still runs in case the OS overrides
  config.channelCount = 1;       // mono — we deinterleave & downmix in CoreAudio
  config.width = 2;              // minimise the video plane we have to ignore
  config.height = 2;
  // 1 fps is the lowest SCStreamConfiguration accepts; we don't
  // care about video frames but the stream must produce them.
  config.minimumFrameInterval = CMTimeMake(1, 1);

  MeetUAudioCapture* capture = [[MeetUAudioCapture alloc] init];
  NSError* addErr = nil;
  SCStream* stream = [[SCStream alloc] initWithFilter:filter configuration:config delegate:capture];
  BOOL added = [stream addStreamOutput:capture type:SCStreamOutputTypeAudio sampleHandlerQueue:dispatch_get_global_queue(QOS_CLASS_USER_INTERACTIVE, 0) error:&addErr];
  if (!added) {
    done(addErr ?: [NSError errorWithDomain:@"MeetU" code:-1 userInfo:@{ NSLocalizedDescriptionKey: @"addStreamOutput failed" }]);
    return;
  }
  capture.stream = stream;
  globals().capture = capture;

  [stream startCaptureWithCompletionHandler:^(NSError* _Nullable startErr) {
    done(startErr);
  }];
}

API_AVAILABLE(macos(13.0))
static Napi::Value StartCapture(const Napi::CallbackInfo& info) {
  auto env = info.Env();
  auto deferred = Napi::Promise::Deferred::New(env);

  // Validate arguments. Expected shape:
  //   start({ pid?: number, onAudio: Function, onError: Function })
  if (info.Length() < 1 || !info[0].IsObject()) {
    deferred.Reject(Napi::Error::New(env, "start() requires an options object").Value());
    return deferred.Promise();
  }
  auto opts = info[0].As<Napi::Object>();
  auto onAudio = opts.Get("onAudio");
  auto onError = opts.Get("onError");
  if (!onAudio.IsFunction() || !onError.IsFunction()) {
    deferred.Reject(Napi::Error::New(env, "start() requires onAudio and onError functions").Value());
    return deferred.Promise();
  }

  pid_t targetPid = 0;
  auto pidVal = opts.Get("pid");
  if (pidVal.IsNumber()) {
    targetPid = static_cast<pid_t>(pidVal.As<Napi::Number>().Int32Value());
  }

  {
    std::lock_guard<std::mutex> lock(globals().mutex);
    if (globals().running.load()) {
      deferred.Reject(Napi::Error::New(env, "capture already running; call stop() first").Value());
      return deferred.Promise();
    }
    globals().running = true;

    globals().tsfnAudio = Napi::ThreadSafeFunction::New(
      env, onAudio.As<Napi::Function>(), "meetu-audio-tsfn", 0, 1);
    globals().tsfnError = Napi::ThreadSafeFunction::New(
      env, onError.As<Napi::Function>(), "meetu-error-tsfn", 0, 1);
  }

  // The SCShareableContent fetch + filter construction is async.
  // We capture the deferred in a block-stored Napi::Reference-ish
  // shim... actually Napi::Promise::Deferred isn't move-only across
  // a block, but it's safe to capture by copy because it's a
  // shared pointer underneath. Bridge via a heap-allocated copy
  // to be explicit.
  auto deferredPtr = std::make_shared<Napi::Promise::Deferred>(deferred);

  [SCShareableContent getShareableContentWithCompletionHandler:^(SCShareableContent* _Nullable content, NSError* _Nullable err) {
    auto cleanupAndReject = [deferredPtr](NSError* e) {
      auto status = globals().tsfnAudio.BlockingCall([deferredPtr, e](Napi::Env env, Napi::Function) {
        deferredPtr->Reject(Napi::Error::New(env, e.localizedDescription ? std::string(e.localizedDescription.UTF8String) : "unknown").Value());
      });
      if (status != napi_ok) {
        // best effort — the JS env is gone
      }
      globals().tsfnAudio.Release();
      globals().tsfnError.Release();
      globals().running = false;
    };

    if (err || !content) {
      cleanupAndReject(err ?: [NSError errorWithDomain:@"MeetU" code:-2 userInfo:@{ NSLocalizedDescriptionKey: @"no shareable content" }]);
      return;
    }

    SCContentFilter* filter = nil;
    if (targetPid > 0) {
      // Per-app capture: find the running application whose pid
      // matches. We use SCContentFilter(desktopIndependentWindow:)
      // or the application list variant — the cleanest match here
      // is `initWithDisplay:includingApplications:exceptingWindows:`,
      // which captures audio produced BY the target apps anywhere
      // on the screen (independent of window visibility).
      SCRunningApplication* target = nil;
      for (SCRunningApplication* a in content.applications) {
        if (a.processID == targetPid) { target = a; break; }
      }
      if (!target) {
        cleanupAndReject([NSError errorWithDomain:@"MeetU" code:-3 userInfo:@{ NSLocalizedDescriptionKey: @"target pid not found in shareable applications" }]);
        return;
      }
      SCDisplay* anyDisplay = content.displays.firstObject;
      if (!anyDisplay) {
        cleanupAndReject([NSError errorWithDomain:@"MeetU" code:-4 userInfo:@{ NSLocalizedDescriptionKey: @"no displays available" }]);
        return;
      }
      filter = [[SCContentFilter alloc] initWithDisplay:anyDisplay includingApplications:@[target] exceptingWindows:@[]];
    } else {
      // Full-system capture: any display works; capturesAudio=YES
      // in the config is what actually pulls the system mix.
      SCDisplay* anyDisplay = content.displays.firstObject;
      if (!anyDisplay) {
        cleanupAndReject([NSError errorWithDomain:@"MeetU" code:-5 userInfo:@{ NSLocalizedDescriptionKey: @"no displays available" }]);
        return;
      }
      filter = [[SCContentFilter alloc] initWithDisplay:anyDisplay excludingWindows:@[]];
    }

    startCaptureWithFilter(filter, [deferredPtr](NSError* startErr) {
      if (startErr) {
        auto status = globals().tsfnAudio.BlockingCall([deferredPtr, startErr](Napi::Env env, Napi::Function) {
          deferredPtr->Reject(Napi::Error::New(env, startErr.localizedDescription ? std::string(startErr.localizedDescription.UTF8String) : "start failed").Value());
        });
        if (status != napi_ok) { /* JS gone */ }
        globals().tsfnAudio.Release();
        globals().tsfnError.Release();
        globals().running = false;
        return;
      }
      auto status = globals().tsfnAudio.BlockingCall([deferredPtr](Napi::Env env, Napi::Function) {
        deferredPtr->Resolve(env.Undefined());
      });
      if (status != napi_ok) { /* JS gone */ }
    });
  }];

  return deferred.Promise();
}

API_AVAILABLE(macos(13.0))
static Napi::Value StopCapture(const Napi::CallbackInfo& info) {
  auto env = info.Env();
  auto deferred = Napi::Promise::Deferred::New(env);

  MeetUAudioCapture* capture = nil;
  {
    std::lock_guard<std::mutex> lock(globals().mutex);
    capture = globals().capture;
    globals().capture = nil;
  }

  if (!capture || !capture.stream) {
    globals().running = false;
    deferred.Resolve(env.Undefined());
    return deferred.Promise();
  }

  auto deferredPtr = std::make_shared<Napi::Promise::Deferred>(deferred);
  [capture.stream stopCaptureWithCompletionHandler:^(NSError* _Nullable err) {
    // Release the ThreadSafeFunctions now that no more audio
    // callbacks will fire. If we released them in startCapture's
    // error path AND the stream still managed to fire a frame
    // before stopping, we'd deref a freed function. Releasing in
    // the stop callback closes that race.
    auto status = globals().tsfnAudio.BlockingCall([deferredPtr, err](Napi::Env env, Napi::Function) {
      if (err) {
        deferredPtr->Reject(Napi::Error::New(env, err.localizedDescription ? std::string(err.localizedDescription.UTF8String) : "stop failed").Value());
      } else {
        deferredPtr->Resolve(env.Undefined());
      }
    });
    if (status != napi_ok) { /* JS gone */ }
    globals().tsfnAudio.Release();
    globals().tsfnError.Release();
    globals().running = false;
  }];

  return deferred.Promise();
}

API_AVAILABLE(macos(13.0))
static Napi::Value ListApplications(const Napi::CallbackInfo& info) {
  auto env = info.Env();
  auto deferred = Napi::Promise::Deferred::New(env);

  // We need a thread-safe way to resolve the promise from the
  // SCShareableContent completion handler (which fires on a
  // background queue). Wrap a TSFN around an anonymous JS
  // resolver — same pattern as start().
  auto resolver = Napi::Function::New(env, [](const Napi::CallbackInfo&) {
    return Napi::Value();
  });
  auto tsfn = Napi::ThreadSafeFunction::New(env, resolver, "meetu-list-tsfn", 0, 1);
  auto deferredPtr = std::make_shared<Napi::Promise::Deferred>(deferred);

  [SCShareableContent getShareableContentWithCompletionHandler:^(SCShareableContent* _Nullable content, NSError* _Nullable err) {
    if (err || !content) {
      tsfn.BlockingCall([deferredPtr, err](Napi::Env env, Napi::Function) {
        deferredPtr->Reject(Napi::Error::New(env, err.localizedDescription ? std::string(err.localizedDescription.UTF8String) : "no content").Value());
      });
      tsfn.Release();
      return;
    }

    // Hop to the JS thread to build the result array.
    NSArray<SCRunningApplication*>* apps = content.applications;
    // Copy data out of NSArray here so the block can capture
    // POD values for the JS-thread lambda; SCRunningApplication
    // is not necessarily JS-thread safe.
    struct AppEntry { int pid; std::string name; std::string bundleId; };
    auto entries = std::make_shared<std::vector<AppEntry>>();
    entries->reserve(apps.count);
    for (SCRunningApplication* a in apps) {
      entries->push_back({
        .pid = static_cast<int>(a.processID),
        .name = a.applicationName ? std::string(a.applicationName.UTF8String) : std::string(""),
        .bundleId = a.bundleIdentifier ? std::string(a.bundleIdentifier.UTF8String) : std::string(""),
      });
    }
    tsfn.BlockingCall([deferredPtr, entries](Napi::Env env, Napi::Function) {
      auto arr = Napi::Array::New(env, entries->size());
      for (size_t i = 0; i < entries->size(); ++i) {
        auto obj = Napi::Object::New(env);
        obj.Set("pid", Napi::Number::New(env, (*entries)[i].pid));
        obj.Set("name", Napi::String::New(env, (*entries)[i].name));
        obj.Set("bundleId", Napi::String::New(env, (*entries)[i].bundleId));
        arr.Set(i, obj);
      }
      deferredPtr->Resolve(arr);
    });
    tsfn.Release();
  }];

  return deferred.Promise();
}

} // namespace meetu

#endif // MEETU_HAS_SCK

// ── Module init ──────────────────────────────────────────────

static Napi::Object Init(Napi::Env env, Napi::Object exports) {
#if MEETU_HAS_SCK
  if (@available(macOS 13.0, *)) {
    exports.Set("available", Napi::Boolean::New(env, true));
    exports.Set("start", Napi::Function::New(env, meetu::StartCapture));
    exports.Set("stop", Napi::Function::New(env, meetu::StopCapture));
    exports.Set("listApplications", Napi::Function::New(env, meetu::ListApplications));
  } else {
    // Built against the macOS 13+ SDK but running on an older OS.
    exports.Set("available", Napi::Boolean::New(env, false));
    exports.Set("reason", Napi::String::New(env, "macOS 13 or newer required at runtime"));
  }
#else
  exports.Set("available", Napi::Boolean::New(env, false));
  exports.Set("reason", Napi::String::New(env, "addon was not built with the macOS 13+ SDK"));
#endif
  return exports;
}

NODE_API_MODULE(meetu_screencapture, Init)
