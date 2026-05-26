# Manual Verification Checklist / 真机验证清单

Some features can only be fully verified on real hardware, with real OS
permissions, or with a user-supplied API key — things CI and unit tests
cannot do. This checklist covers exactly those gaps so a maintainer can
sign off a release.

有些功能只能在真机上、带真实系统权限、或用用户自己的 API Key 才能完整验证
——这些是 CI 和单元测试覆盖不到的。本清单专门列出这些缺口，方便维护者在发版
前逐项确认。

## What CI already covers (don't re-test by hand)

`npm run typecheck && npm run lint && npm test && npm run check-licenses`
on every push/PR covers: type safety, lint, 200+ unit tests (STT engine
logic, audio windowing/ordering, IPC wrappers via injected fakes,
probes, migrations, export), and the zero-GPL license audit. **The
items below are the ones that need a human.**

---

## Priority items (built but not verifiable in CI)

### 1. macOS native system audio (ScreenCaptureKit) — PR #5

Requires macOS 13+ and a one-time **Screen & System Audio Recording**
permission grant that can't be scripted (TCC is interactive).

需要 macOS 13+，以及一次性的「屏幕与系统录制」权限授权（TCC 无法脚本化）。

**Steps**
1. Build + run the app on macOS 13+ (`npm run dev`, or a packaged build).
2. Settings → Preferences → Audio → click **"🔊 System Audio (native loopback)"**. It should be enabled (not greyed out) and show a per-app **"Capture target"** dropdown.
3. Start recording. macOS should prompt for **Screen & System Audio Recording** permission on first use. Grant it in System Settings → Privacy & Security, then **restart the app**.
4. Play audio from any app (e.g. a YouTube video) and confirm a transcript appears (with a cloud STT key configured, or with Local Whisper — see item 2).
5. **Per-app capture:** in "Capture target", pick a single running app (e.g. a browser), record, and confirm **only that app's** audio is transcribed (other apps' sound is excluded).

**Expected**
- ✅ Whole-system capture transcribes everything playing.
- ✅ Per-app capture transcribes only the selected app.
- ✅ No crash on start/stop, and repeated start→stop→start cycles work (exercises the native session state machine).

**If it fails**
- Button greyed out on macOS 13+ → the native addon didn't build. Run `npm run build:macos-native` and check the output; re-open Settings.
- Permission denied → the Settings card shows a grant-and-restart hint; follow it.
- Silent / dead audio after granting → confirm the permission is actually checked in System Settings and the app was fully restarted.

---

### 2. Local Whisper offline STT (whisper.cpp via smart-whisper) — PR #6/#7

The transcription **core** is already verified end-to-end (the tiny
model transcribes the standard JFK sample correctly). What still needs a
human is the **full in-app pipeline**: model download UX → capture →
IPC → on-device transcription → captions on screen.

转写**核心**已端到端验证（tiny 模型转 JFK 样本正确）。仍需人工验证的是**完整
的 app 内链路**：模型下载 → 采集 → IPC → 本机转写 → 屏幕出字。

**Steps**
1. Run the app. Settings → Speech Engine → select **"Local Whisper (Offline)"**. A model manager appears.
2. Click **Download** on `base` (≈142 MB). Confirm the progress % advances and ends as **"✓ downloaded · active"**. (A download failure should now show an inline error — verify by temporarily killing the network mid-download.)
3. Start recording and speak (or play speech audio). Confirm captions appear ~12 s after speech begins (the window size), fully offline — **disconnect the network** to prove no audio leaves the device.
4. Stop recording; confirm the trailing partial window's words still land (last sentence isn't dropped).
5. **No-model fallback:** with no model downloaded, start recording and confirm it falls back to demo/mock mode with the "no model" warning (does not hang or crash).
6. **Silence handling:** stay silent for a stretch mid-recording; confirm no phantom captions appear (no "Thank you for watching" / 字幕组 hallucinations — silent windows are gated out before inference, and any that slip through are filtered).
7. **Model management:** confirm each downloaded model shows its size (MB); click **Delete** and confirm the file is removed (size reclaimed) and the row returns to a Download button.

**Expected**
- ✅ Captions appear offline; pulling the network changes nothing.
- ✅ Transcript order is correct even across multiple windows.
- ✅ Switching models (e.g. `base` → `small`) and re-recording works.

**If it fails**
- "Local Whisper native module unavailable" → smart-whisper didn't build (it's an optionalDependency). Reinstall with build tools (Xcode CLT / build-essential) so its install hook + `electron-rebuild` can compile whisper.cpp.
- Captions never appear but no error → check the main-process console for `[STT] Local Whisper transcribe failed`.

---

### 3. Windows system audio loopback (WASAPI via Electron) — PR #4

CI can't run Windows + real playback.

**Steps**
1. Run the app on Windows 10+. Settings → Preferences → Audio → enable **"🔊 System Audio (native loopback)"** (should be enabled; no per-app dropdown — Windows is whole-system only).
2. Play audio from any app; start recording; confirm a transcript appears (needs a cloud STT key or Local Whisper).
3. On Windows 9 / older, confirm the option is greyed out with a version message.

**Expected:** ✅ whole-system audio is captured driverlessly (no Stereo Mix needed).

---

## Secondary (user-supplied keys — verify if you have them)

These are BYOK cloud engines; unit tests cover the request/response
shaping with mocks, but a live key confirms the real endpoint.

| Engine | How to verify | Needs |
|--------|---------------|-------|
| Deepgram | Settings → Speech Engine → Deepgram → paste key → **Test** shows ✅; then record and confirm streaming captions | Deepgram key + network (may need VPN in some regions) |
| OpenAI Whisper API | Same, expect ~5 s segmented captions | OpenAI key |
| iFlytek (讯飞) | Same; key format is `AppID:APIKey:APISecret`; best for Mandarin | iFlytek IAT credentials |
| AI features (translate / summary / @-mention / speech advice) | Configure any AI provider key, record, confirm translation + 5-min summary populate | One AI provider key |

---

## Export & misc (quick to eyeball)

- **DOCX/Markdown export** (PR #2): finish a meeting → export → confirm a `.docx` / `.md` lands in `~/MeetingAI/minutes/` and opens cleanly, with the AI-generated disclaimer footer.
- **PDF export**: from the Summary view, click **PDF**; confirm a `.pdf` lands in `~/MeetingAI/minutes/` and opens cleanly. **Critically, with a Chinese-language meeting**, confirm the Chinese text renders (not boxes/tofu) — the PDF is produced by Electron's Chromium `printToPDF`, which uses the OS's CJK fonts; the HTML builder is unit-tested but the actual render needs a running app. Check the action-items table and the bilingual disclaimer footer survive page layout.
- **Legal disclaimer + recording consent**: first launch shows the legal disclaimer (must accept to continue); each recording start shows the consent reminder.

---

## Sign-off

A release is good to ship once items **1–3** pass on their target OS and
at least one STT engine in **Secondary** has been confirmed live. Record
the OS versions tested (e.g. "macOS 14.4, Windows 11 23H2") in the
release notes.

发版前：第 1–3 项在对应系统上通过，且 Secondary 里至少一个 STT 引擎用真实
Key 跑通即可。在发版说明里记下测试过的系统版本。
