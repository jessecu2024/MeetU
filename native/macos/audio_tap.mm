// ============================================================
// MeetU macOS ScreenCaptureKit N-API addon (Objective-C++)
//
// Exposes four async N-API functions to the Electron main process:
//
//   available  (boolean)         - built with SDK + running on macOS 13+
//   listApplications() -> Promise<Array<{ pid, name, bundleId }>>
//   start({ pid?, onAudio, onError }) -> Promise<void>
//   stop() -> Promise<void>
//
// Audio path:
//   SCStream -> CMSampleBuffer (validated Float32 PCM)
//             -> downmix to mono + linear resample to 16 kHz
//             -> ThreadSafeFunction -> renderer subscriber
//
// ── Concurrency / lifecycle model ──
// All session state lives in `Session` behind a single mutex and a
// 4-state machine (Idle/Starting/Running/Stopping). The two
// long-lived ThreadSafeFunctions (audio + error) have EXACTLY ONE
// release point, guarded by `tsfnReleased` so no path can
// double-release or leak them. Promise resolution for the async
// start/stop operations uses a SEPARATE short-lived TSFN created on
// the JS thread and released once after the single resolve/reject —
// it never aliases the audio/error TSFNs.
//
// Races handled:
//   - stop() during Starting: sets `cancelRequested`; the in-flight
//     start completion observes it (under the same mutex), stops the
//     stream it just created, tears down, and rejects start. stop()
//     resolves immediately because teardown is guaranteed by that
//     completion.
//   - fatal SCStream error (didStopWithError) during Running: forwards
//     the error, then tears down to Idle so a subsequent start() does
//     not alias a stale session.
//   - audio callbacks after teardown: BlockingCall on a released TSFN
//     returns non-ok; we drop the frame instead of dereferencing
//     freed state.
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

@class MeetUAudioCapture;

namespace meetu {

enum class State { Idle, Starting, Running, Stopping };

struct Session {
  std::mutex mutex;
  State state = State::Idle;
  // Set by stop() when it arrives mid-Starting; observed by the start
  // completion to abort cleanly.
  bool cancelRequested = false;

  MeetUAudioCapture* capture API_AVAILABLE(macos(13.0)) = nil;
  SCStream* stream API_AVAILABLE(macos(13.0)) = nil;

  // Monotonic capture generation. Bumped on every teardown so a stale
  // SCStream that delivers a late audio callback AFTER teardown (and
  // possibly after a NEW start replaced tsfnAudio) can detect it is
  // no longer the active capture and drop the frame, instead of
  // delivering old audio into the new session's JS callback. Atomic
  // so the audio callback can read it lock-free.
  std::atomic<uint64_t> generation{0};

  // Long-lived streaming TSFNs. Released exactly once via
  // releaseStreamTsfnsLocked() (idempotent through tsfnReleased).
  Napi::ThreadSafeFunction tsfnAudio;
  Napi::ThreadSafeFunction tsfnError;
  bool tsfnReleased = true;

  void releaseStreamTsfnsLocked() {
    if (!tsfnReleased) {
      tsfnAudio.Release();
      tsfnError.Release();
      tsfnReleased = true;
    }
  }

  // Caller MUST hold `mutex`. Drops references to the stream/capture
  // and releases the streaming TSFNs. Leaves `state` for the caller
  // to set (usually Idle).
  void teardownLocked() {
    releaseStreamTsfnsLocked();
    if (@available(macOS 13.0, *)) {
      capture = nil;
      stream = nil;
    }
    cancelRequested = false;
    // Invalidate the generation so any late callback from the
    // just-torn-down capture (whose stamped generation now differs)
    // drops its frame instead of using a possibly-reassigned TSFN.
    generation.fetch_add(1);
  }
};

static Session& session() {
  static Session s;
  return s;
}

struct AudioFrame { std::vector<float> samples; }; // mono, 16 kHz
struct ErrorPayload { std::string message; int code; };

} // namespace meetu

// ── Objective-C capture delegate ────────────────────────────

API_AVAILABLE(macos(13.0))
@interface MeetUAudioCapture : NSObject <SCStreamDelegate, SCStreamOutput>
@property (nonatomic, assign) double sourceSampleRate; // typically 48000
@property (nonatomic, assign) double targetSampleRate; // 16000
@property (nonatomic, assign) double resamplePhase;
@property (nonatomic, strong) NSMutableData* carryBuffer; // leftover mono Float32 samples
// Generation stamp assigned at start; the callback drops frames once
// session().generation has moved past this value (i.e. after teardown).
@property (nonatomic, assign) uint64_t generation;
// Per-capture SERIAL queue for audio sample delivery. ScreenCaptureKit
// is handed this queue via addStreamOutput; using a serial queue (not
// the global concurrent queue) guarantees didOutputSampleBuffer never
// runs concurrently with itself, so the resampler's carryBuffer /
// resamplePhase mutation is single-threaded and race-free. Retained
// as a strong property so it outlives the stream.
@property (nonatomic, strong) dispatch_queue_t sampleQueue;
@end

@implementation MeetUAudioCapture

- (instancetype)init {
  if ((self = [super init])) {
    _targetSampleRate = 16000.0;
    _sourceSampleRate = 48000.0;
    _resamplePhase = 0.0;
    _carryBuffer = [NSMutableData data];
    _sampleQueue = dispatch_queue_create("com.meetu.screencapture.audio", DISPATCH_QUEUE_SERIAL);
  }
  return self;
}

- (void)stream:(SCStream*)stream didOutputSampleBuffer:(CMSampleBufferRef)sampleBuffer ofType:(SCStreamOutputType)type {
  if (type != SCStreamOutputTypeAudio) return;
  if (!CMSampleBufferIsValid(sampleBuffer)) return;
  // Drop frames from a stale capture: once teardown bumped
  // session().generation past our stamp, this stream is no longer the
  // active one (a new start may have replaced tsfnAudio). Lock-free
  // read; teardown's BlockingCall safety still backstops us.
  if (self.generation != meetu::session().generation.load()) return;

  CMFormatDescriptionRef fmt = CMSampleBufferGetFormatDescription(sampleBuffer);
  if (!fmt) return;
  const AudioStreamBasicDescription* asbd = CMAudioFormatDescriptionGetStreamBasicDescription(fmt);
  if (!asbd) return;

  // ── Format validation ──
  // ScreenCaptureKit canonically delivers PCM Float32; we configured
  // channelCount=1 in the stream config. But we must not blindly
  // reinterpret bytes: validate Float32 + 32-bit, and handle the
  // (rare) case where we still receive interleaved multichannel by
  // downmixing. Anything we can't interpret as float is dropped with
  // a one-time warning rather than emitting garbage PCM.
  const bool isFloat = (asbd->mFormatFlags & kAudioFormatFlagIsFloat) != 0;
  const bool is32bit = (asbd->mBitsPerChannel == 32);
  if (!isFloat || !is32bit) {
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
      NSLog(@"[MeetU] Unsupported audio format (flags=%u bits=%u) — dropping frames", asbd->mFormatFlags, asbd->mBitsPerChannel);
    });
    return;
  }
  const bool isNonInterleaved = (asbd->mFormatFlags & kAudioFormatFlagIsNonInterleaved) != 0;
  const UInt32 channels = asbd->mChannelsPerFrame > 0 ? asbd->mChannelsPerFrame : 1;
  if (asbd->mSampleRate > 0) self.sourceSampleRate = asbd->mSampleRate;

  // Two-pass sizing: a stack `AudioBufferList` only has room for ONE
  // AudioBuffer, which is insufficient for non-interleaved
  // multichannel (one buffer per channel). First call with a null
  // list to learn the required byte size, then heap-allocate.
  size_t ablSizeNeeded = 0;
  OSStatus sizeSt = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
    sampleBuffer, &ablSizeNeeded, nullptr, 0, nullptr, nullptr, 0, nullptr);
  if (sizeSt != noErr || ablSizeNeeded == 0) return;

  std::vector<uint8_t> ablStorage(ablSizeNeeded);
  AudioBufferList* abl = reinterpret_cast<AudioBufferList*>(ablStorage.data());
  CMBlockBufferRef block = nullptr;
  OSStatus st = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
    sampleBuffer, nullptr, abl, ablSizeNeeded,
    nullptr, nullptr, 0, &block);
  if (st != noErr || abl->mNumberBuffers == 0) {
    if (block) CFRelease(block);
    return;
  }

  // Build a mono Float32 vector from the buffer list, regardless of
  // interleaved/non-interleaved layout.
  std::vector<float> mono;
  if (isNonInterleaved) {
    // Each channel is a separate AudioBuffer. Average across channels.
    const UInt32 nbuf = abl->mNumberBuffers;
    const float* ch0 = static_cast<const float*>(abl->mBuffers[0].mData);
    if (!ch0) { if (block) CFRelease(block); return; }
    const size_t frames = abl->mBuffers[0].mDataByteSize / sizeof(float);
    mono.resize(frames, 0.0f);
    for (UInt32 b = 0; b < nbuf; ++b) {
      const float* ch = static_cast<const float*>(abl->mBuffers[b].mData);
      if (!ch) continue;
      const size_t n = std::min<size_t>(frames, abl->mBuffers[b].mDataByteSize / sizeof(float));
      for (size_t i = 0; i < n; ++i) mono[i] += ch[i];
    }
    if (nbuf > 1) { for (auto& s : mono) s /= static_cast<float>(nbuf); }
  } else {
    // Single interleaved buffer with `channels` samples per frame.
    const float* src = static_cast<const float*>(abl->mBuffers[0].mData);
    if (!src) { if (block) CFRelease(block); return; }
    const size_t totalSamples = abl->mBuffers[0].mDataByteSize / sizeof(float);
    const size_t frames = channels > 0 ? totalSamples / channels : totalSamples;
    mono.resize(frames, 0.0f);
    for (size_t f = 0; f < frames; ++f) {
      float acc = 0.0f;
      for (UInt32 c = 0; c < channels; ++c) acc += src[f * channels + c];
      mono[f] = acc / static_cast<float>(channels);
    }
  }
  if (block) CFRelease(block);
  if (mono.empty()) return;

  // ── Carry-buffer linear decimation to 16 kHz ──
  const NSUInteger carryCount = self.carryBuffer.length / sizeof(float);
  std::vector<float> merged;
  merged.reserve(carryCount + mono.size());
  if (carryCount > 0) {
    const float* carryPtr = static_cast<const float*>(self.carryBuffer.bytes);
    merged.insert(merged.end(), carryPtr, carryPtr + carryCount);
  }
  merged.insert(merged.end(), mono.begin(), mono.end());

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
  const size_t drop = static_cast<size_t>(phase);
  if (drop < merged.size()) {
    const size_t tailSize = merged.size() - drop;
    [self.carryBuffer setLength:tailSize * sizeof(float)];
    memcpy(self.carryBuffer.mutableBytes, merged.data() + drop, tailSize * sizeof(float));
    self.resamplePhase = phase - static_cast<double>(drop);
  } else {
    [self.carryBuffer setLength:0];
    double newPhase = phase - static_cast<double>(merged.size());
    if (newPhase < 0) newPhase = 0;
    self.resamplePhase = newPhase;
  }
  if (out.empty()) return;

  auto frame = new meetu::AudioFrame();
  frame->samples = std::move(out);
  // Deliver to JS safely against a concurrent teardown. The early
  // lock-free generation check at the top of this method only skips
  // work for obviously stale captures; it is NOT sufficient, because
  // teardown could bump the generation + Release() the TSFN + a new
  // start could reassign session().tsfnAudio during the format-parse /
  // resample work above — a check-then-use TOCTOU.
  //
  // A copied Napi::ThreadSafeFunction does NOT keep the underlying
  // napi_threadsafe_function alive (the copy just aliases the handle;
  // it does not Acquire()). So we must, UNDER the session mutex:
  //   1. re-check generation + tsfnReleased (teardown also holds this
  //      mutex when it Releases, so a passing check here means the
  //      TSFN is still live and is THIS session's), and
  //   2. Acquire() an extra ref so the handle cannot be finalized
  //      between unlocking and the BlockingCall.
  // Then BlockingCall outside the lock (calling a TSFN under the mutex
  // risks deadlock) and Release() our extra ref afterwards. A new start
  // cannot have installed a fresh tsfnAudio without a prior teardown
  // bumping the generation, which the under-lock re-check observes —
  // so we can never Acquire/aliase a different session's TSFN.
  Napi::ThreadSafeFunction tsfnLocal;
  bool acquired = false;
  {
    std::lock_guard<std::mutex> lock(meetu::session().mutex);
    if (self.generation == meetu::session().generation.load() && !meetu::session().tsfnReleased) {
      tsfnLocal = meetu::session().tsfnAudio;
      if (tsfnLocal.Acquire() == napi_ok) acquired = true;
    }
  }
  if (!acquired) { delete frame; return; }

  auto status = tsfnLocal.BlockingCall(frame, [](Napi::Env env, Napi::Function jsCallback, meetu::AudioFrame* data) {
    if (env && jsCallback) {
      const size_t byteLen = data->samples.size() * sizeof(float);
      auto buf = Napi::ArrayBuffer::New(env, byteLen);
      memcpy(buf.Data(), data->samples.data(), byteLen);
      auto f32 = Napi::TypedArrayOf<float>::New(env, data->samples.size(), buf, 0, napi_float32_array);
      jsCallback.Call({ f32 });
    }
    delete data;
  });
  if (status != napi_ok) delete frame;
  // Balance the Acquire(); when this drops the count to zero (after
  // teardown's own Release) the TSFN finalizes cleanly.
  tsfnLocal.Release();
}

- (void)stream:(SCStream*)stream didStopWithError:(NSError*)error {
  auto& s = meetu::session();
  // Forward the error then tear down to Idle so a fatal stop doesn't
  // leave a half-alive session that the next start() would alias.
  {
    std::lock_guard<std::mutex> lock(s.mutex);
    if (s.state != meetu::State::Running) return; // already stopping/idle
    s.state = meetu::State::Stopping;
  }
  auto payload = new meetu::ErrorPayload{
    .message = error.localizedDescription ? std::string(error.localizedDescription.UTF8String) : "unknown",
    .code = static_cast<int>(error.code),
  };
  auto status = s.tsfnError.BlockingCall(payload, [](Napi::Env env, Napi::Function jsCallback, meetu::ErrorPayload* data) {
    if (env && jsCallback) {
      auto obj = Napi::Object::New(env);
      obj.Set("message", Napi::String::New(env, data->message));
      obj.Set("code", Napi::Number::New(env, data->code));
      jsCallback.Call({ obj });
    }
    delete data;
  });
  if (status != napi_ok) delete payload;
  {
    std::lock_guard<std::mutex> lock(s.mutex);
    s.teardownLocked();
    s.state = meetu::State::Idle;
  }
}

@end

// ── N-API surface ───────────────────────────────────────────

namespace meetu {

// Resolve/reject a Promise::Deferred from a background thread via a
// short-lived TSFN created on the JS thread (passed in). Releases the
// TSFN after the single call. `tsfnOp` and `deferred` are owned by the
// operation and used exactly once.
API_AVAILABLE(macos(13.0))
static void settleStart(std::shared_ptr<Napi::Promise::Deferred> deferred,
                        std::shared_ptr<Napi::ThreadSafeFunction> tsfnOp,
                        bool resolve, std::string errMsg) {
  auto status = tsfnOp->BlockingCall([deferred, resolve, errMsg](Napi::Env env, Napi::Function) {
    if (resolve) deferred->Resolve(env.Undefined());
    else deferred->Reject(Napi::Error::New(env, errMsg).Value());
  });
  if (status != napi_ok) { /* JS env gone */ }
  tsfnOp->Release();
}

API_AVAILABLE(macos(13.0))
static Napi::Value StartCapture(const Napi::CallbackInfo& info) {
  auto env = info.Env();
  auto deferred = Napi::Promise::Deferred::New(env);

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
  if (pidVal.IsNumber()) targetPid = static_cast<pid_t>(pidVal.As<Napi::Number>().Int32Value());

  auto& s = session();
  {
    std::lock_guard<std::mutex> lock(s.mutex);
    if (s.state != State::Idle) {
      deferred.Reject(Napi::Error::New(env, "capture already active; call stop() first").Value());
      return deferred.Promise();
    }
    s.state = State::Starting;
    s.cancelRequested = false;
    s.tsfnAudio = Napi::ThreadSafeFunction::New(env, onAudio.As<Napi::Function>(), "meetu-audio-tsfn", 0, 1);
    s.tsfnError = Napi::ThreadSafeFunction::New(env, onError.As<Napi::Function>(), "meetu-error-tsfn", 0, 1);
    s.tsfnReleased = false;
  }

  auto deferredPtr = std::make_shared<Napi::Promise::Deferred>(deferred);
  // Short-lived op TSFN for resolving THIS start promise. Created on
  // the JS thread; released once inside settleStart.
  auto tsfnStart = std::make_shared<Napi::ThreadSafeFunction>(
    Napi::ThreadSafeFunction::New(env, Napi::Function::New(env, [](const Napi::CallbackInfo&) {}), "meetu-start-op", 0, 1));

  [SCShareableContent getShareableContentWithCompletionHandler:^(SCShareableContent* _Nullable content, NSError* _Nullable err) {
    auto abortToIdle = [deferredPtr, tsfnStart](const std::string& msg) {
      {
        std::lock_guard<std::mutex> lock(session().mutex);
        session().teardownLocked();
        session().state = State::Idle;
      }
      settleStart(deferredPtr, tsfnStart, false, msg);
    };

    // Honor a stop() that arrived while we were fetching content. No
    // stream exists yet, so teardown here is safe (no late callbacks).
    bool cancelledEarly = false;
    {
      std::lock_guard<std::mutex> lock(session().mutex);
      if (session().cancelRequested) {
        session().teardownLocked();
        session().state = State::Idle;
        cancelledEarly = true;
      }
    }
    if (cancelledEarly) {
      // settleStart performs a TSFN BlockingCall — call it OUTSIDE the
      // session mutex (no TSFN calls while holding the lock).
      settleStart(deferredPtr, tsfnStart, false, "capture cancelled before start");
      return;
    }

    if (err || !content) {
      abortToIdle(err && err.localizedDescription ? std::string(err.localizedDescription.UTF8String) : "no shareable content");
      return;
    }

    SCContentFilter* filter = nil;
    SCDisplay* anyDisplay = content.displays.firstObject;
    if (!anyDisplay) { abortToIdle("no displays available"); return; }
    if (targetPid > 0) {
      SCRunningApplication* target = nil;
      for (SCRunningApplication* a in content.applications) {
        if (a.processID == targetPid) { target = a; break; }
      }
      if (!target) { abortToIdle("target pid not found in shareable applications"); return; }
      filter = [[SCContentFilter alloc] initWithDisplay:anyDisplay includingApplications:@[target] exceptingWindows:@[]];
    } else {
      filter = [[SCContentFilter alloc] initWithDisplay:anyDisplay excludingWindows:@[]];
    }

    auto config = [[SCStreamConfiguration alloc] init];
    config.capturesAudio = YES;
    config.sampleRate = 48000;
    config.channelCount = 1;
    config.width = 2;
    config.height = 2;
    config.minimumFrameInterval = CMTimeMake(1, 1);

    MeetUAudioCapture* capture = [[MeetUAudioCapture alloc] init];
    // Stamp the capture with the current generation at CREATION (not at
    // run-success) so its very first audio callbacks are accepted. No
    // teardown can bump the generation between here and Running: we're
    // in Starting (which blocks a new start), and the only mid-Starting
    // teardown is the cancel path, which diverges before this capture
    // ever streams.
    capture.generation = session().generation.load();
    SCStream* stream = [[SCStream alloc] initWithFilter:filter configuration:config delegate:capture];
    NSError* addErr = nil;
    // Deliver samples on the capture's own SERIAL queue so the
    // resampler state (carryBuffer / resamplePhase) is never mutated
    // concurrently. The global concurrent queue could overlap
    // callbacks and corrupt that state.
    BOOL added = [stream addStreamOutput:capture type:SCStreamOutputTypeAudio
                      sampleHandlerQueue:capture.sampleQueue error:&addErr];
    if (!added) {
      abortToIdle(addErr && addErr.localizedDescription ? std::string(addErr.localizedDescription.UTF8String) : "addStreamOutput failed");
      return;
    }

    [stream startCaptureWithCompletionHandler:^(NSError* _Nullable startErr) {
      // stop() during start → cancel. The stream is now LIVE and may
      // fire audio callbacks until it actually stops, so we must NOT
      // release the TSFNs or go Idle yet — doing so would (a) drop
      // late callbacks onto a released TSFN and (b) let a fresh
      // start() create new TSFNs that an old-stream callback could
      // alias. Instead: go Stopping (which blocks a new start), keep
      // the stream/capture retained by this block, and only
      // teardown + Idle + settle from inside the stop completion.
      bool cancelled = false;
      {
        std::lock_guard<std::mutex> lock(session().mutex);
        cancelled = session().cancelRequested;
        if (cancelled) {
          session().state = State::Stopping;
          // Park strong references in the session so the stream/capture
          // stay alive across the async stopCaptureWithCompletionHandler.
          // The inner stop block does NOT reference them, so under ARC
          // nothing else would retain them once this outer block
          // returns — relying on SCStream retaining itself during async
          // stop is fragile. teardownLocked() nils these on completion.
          session().stream = stream;
          session().capture = capture;
        }
      }
      if (cancelled) {
        [stream stopCaptureWithCompletionHandler:^(NSError* _Nullable) {
          {
            std::lock_guard<std::mutex> lock(session().mutex);
            session().teardownLocked();
            session().state = State::Idle;
          }
          settleStart(deferredPtr, tsfnStart, false, "capture cancelled during start");
        }];
        return;
      }
      if (startErr) {
        // start failed → no live stream, safe to teardown immediately.
        {
          std::lock_guard<std::mutex> lock(session().mutex);
          session().teardownLocked();
          session().state = State::Idle;
        }
        settleStart(deferredPtr, tsfnStart, false, startErr.localizedDescription ? std::string(startErr.localizedDescription.UTF8String) : "start failed");
        return;
      }
      {
        std::lock_guard<std::mutex> lock(session().mutex);
        // capture.generation was stamped at creation (see above); it
        // remains valid because no teardown bumped the generation
        // during Starting.
        session().capture = capture;
        session().stream = stream;
        session().state = State::Running;
      }
      settleStart(deferredPtr, tsfnStart, true, "");
    }];
  }];

  return deferred.Promise();
}

API_AVAILABLE(macos(13.0))
static Napi::Value StopCapture(const Napi::CallbackInfo& info) {
  auto env = info.Env();
  auto deferred = Napi::Promise::Deferred::New(env);
  auto& s = session();

  SCStream* streamToStop = nil;
  {
    std::lock_guard<std::mutex> lock(s.mutex);
    switch (s.state) {
      case State::Idle:
        // Nothing to do.
        deferred.Resolve(env.Undefined());
        return deferred.Promise();
      case State::Starting:
        // Ask the in-flight start completion to abort + teardown. We
        // resolve immediately; teardown is guaranteed by that path.
        s.cancelRequested = true;
        deferred.Resolve(env.Undefined());
        return deferred.Promise();
      case State::Stopping:
        // A stop is already in progress (e.g. fatal error teardown).
        deferred.Resolve(env.Undefined());
        return deferred.Promise();
      case State::Running:
        streamToStop = s.stream;
        s.state = State::Stopping;
        break;
    }
  }

  if (!streamToStop) {
    // Defensive: Running but no stream — just go Idle.
    std::lock_guard<std::mutex> lock(s.mutex);
    s.teardownLocked();
    s.state = State::Idle;
    deferred.Resolve(env.Undefined());
    return deferred.Promise();
  }

  auto deferredPtr = std::make_shared<Napi::Promise::Deferred>(deferred);
  auto tsfnStop = std::make_shared<Napi::ThreadSafeFunction>(
    Napi::ThreadSafeFunction::New(env, Napi::Function::New(env, [](const Napi::CallbackInfo&) {}), "meetu-stop-op", 0, 1));

  [streamToStop stopCaptureWithCompletionHandler:^(NSError* _Nullable err) {
    {
      std::lock_guard<std::mutex> lock(session().mutex);
      session().teardownLocked();
      session().state = State::Idle;
    }
    auto status = tsfnStop->BlockingCall([deferredPtr, err](Napi::Env env, Napi::Function) {
      if (err) deferredPtr->Reject(Napi::Error::New(env, err.localizedDescription ? std::string(err.localizedDescription.UTF8String) : "stop failed").Value());
      else deferredPtr->Resolve(env.Undefined());
    });
    if (status != napi_ok) { /* JS gone */ }
    tsfnStop->Release();
  }];

  return deferred.Promise();
}

API_AVAILABLE(macos(13.0))
static Napi::Value ListApplications(const Napi::CallbackInfo& info) {
  auto env = info.Env();
  auto deferred = Napi::Promise::Deferred::New(env);
  auto resolver = Napi::Function::New(env, [](const Napi::CallbackInfo&) {});
  auto tsfn = std::make_shared<Napi::ThreadSafeFunction>(
    Napi::ThreadSafeFunction::New(env, resolver, "meetu-list-tsfn", 0, 1));
  auto deferredPtr = std::make_shared<Napi::Promise::Deferred>(deferred);

  [SCShareableContent getShareableContentWithCompletionHandler:^(SCShareableContent* _Nullable content, NSError* _Nullable err) {
    if (err || !content) {
      tsfn->BlockingCall([deferredPtr, err](Napi::Env env, Napi::Function) {
        deferredPtr->Reject(Napi::Error::New(env, err && err.localizedDescription ? std::string(err.localizedDescription.UTF8String) : "no content").Value());
      });
      tsfn->Release();
      return;
    }
    struct AppEntry { int pid; std::string name; std::string bundleId; };
    auto entries = std::make_shared<std::vector<AppEntry>>();
    entries->reserve(content.applications.count);
    for (SCRunningApplication* a in content.applications) {
      entries->push_back({
        static_cast<int>(a.processID),
        a.applicationName ? std::string(a.applicationName.UTF8String) : std::string(""),
        a.bundleIdentifier ? std::string(a.bundleIdentifier.UTF8String) : std::string(""),
      });
    }
    tsfn->BlockingCall([deferredPtr, entries](Napi::Env env, Napi::Function) {
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
    tsfn->Release();
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
