# MeetU (开会啦) — Claude Code 开发指南

## 当前实现状态（v1.1.0，最新一次审计：2026-05-21）

下面这张表反映**代码实际状态**，不是路线图。改 README、CLAUDE.md 或营销材料前先看这里。

| 模块 | 状态 | 说明 |
|------|------|------|
| 麦克风录音（`getUserMedia`） | ✅ Stable | 单声道麦克风 + Windows Stereo Mix / macOS 虚拟声卡 loopback 路径走通 |
| Windows 系统音频 loopback (整机捕获) | ✅ Stable | Windows 10+ via Electron `setDisplayMediaRequestHandler` + `audio:'loopback'`(内部用 WASAPI loopback)。`SettingsModal` 里"🔊 System Audio (native loopback)"开关在 Windows 上 enabled;`SYSTEM_AUDIO_DEVICE_ID` 哨兵触发 `capture.ts` 走 `getDisplayMedia` 分支,旁路 `getUserMedia`。零 GPL 驱动 |
| macOS 系统音频捕获 (整机 + per-app) | 🟡 Implemented — 待真机验证 | `native/macos/audio_tap.mm` 原生 N-API (Objective-C++) 模块直接调 ScreenCaptureKit:`listApplications`/`start({pid?})`/`stop`。整机或按 app(`SCContentFilter(includingApplications:)`)捕获,输出 16-kHz 单声道 Float32 PCM 经 ThreadSafeFunction → IPC → renderer。`capture.ts` 用 playback AudioWorklet (`pcm-playback-worklet.ts`) 把 PCM 重建成 `MediaStream`,复用现有 MediaRecorder/segment/resampler 管线,所以三个 STT 引擎和文件录制全部沿用。`system-audio:probe` 在 darwin 上探测 addon 是否 load 成功来决定 `mode:'macos-native'`。需用户在 *系统设置 → 隐私与安全 → 屏幕与系统录制* 授权;**注:原生音频质量需在授权后的真机上验证,自动化环境无法测**。零 GPL 驱动 |
| Deepgram STT | ✅ Stable | WebSocket 经主进程 IPC，已可用 |
| OpenAI Whisper API STT | ✅ Stable | 引擎以 segment 模式 (`audioMode='segment'`, `segmentDurationMs=5000`) 工作;capture.ts 用并行 MediaRecorder 每 5 秒产出一个完整 webm 文件直接 POST `/v1/audio/transcriptions`;内置 hallucination 过滤丢弃 silence 时的 "Thank you for watching" / 字幕组 类幻觉 |
| 讯飞 STT | ✅ Stable | WebSocket 鉴权:`xfyun-signature.ts` 用 WebCrypto API 计算 HMAC-SHA256;音频管线:`audioMode='pcm-stream'`,capture.ts 启 AudioWorklet 输出 16-kHz 单声道 Float32 PCM,engine 内部转 Int16 + base64 发 `audio/L16;rate=16000` 帧 |
| 阿里语音 STT | ❌ Removed | 之前列在文档/类型中，但代码从未实现，已从 `STTEngineId` 移除 |
| Local Whisper (whisper.cpp) | 🟡 Beta — 核心已验证 | 经 `smart-whisper`(MIT,whisper.cpp N-API binding,optionalDependency)实现。引擎 `audioMode='pcm-stream'`,renderer 累积 ~12s 16-kHz Float32 窗口,经 IPC 送主进程 `electron/audio/local-whisper-native.ts` 调 whisper.cpp 转写。模型管理(下载/删除 ggml + 磁盘占用显示 + 进度)在 SettingsModal。质量增强:每窗口先算 RMS,静音窗口(<0.006)直接跳过不送推理(省 CPU + 根除静音幻觉);返回文本再过 `whisper-hallucinations.ts` 共享幻觉过滤(与 Whisper API 引擎共用)。**转写核心已端到端验证**(tiny 模型转 JFK 样本正确)。Beta 因:需一次性下载模型、速度依赖 CPU/GPU、完整 app 内管线建议真机验证 |
| 所有 7 个 AI Provider (Claude/OpenAI/Gemini/DeepSeek/Qwen/MiniMax/GLM) | ✅ Stable | OpenAI 兼容协议 + Gemini 特例 |
| Markdown 纪要导出 | ✅ Stable | 主进程写 `~/MeetingAI/minutes/*.md` |
| Word (.docx) 纪要导出 | ✅ Stable | `electron/export/docx-generator.ts` 使用 `docx@^8` 在主进程生成 Word 文档（标题/摘要/讨论议题/Action Items 表格/未解决问题/下一步/免责声明），renderer 通过 `file:export` IPC 传 minutes payload，主进程写到 `~/MeetingAI/minutes/*.docx` |
| PDF 纪要导出 | ✅ Stable | `electron/export/pdf-generator.ts` 用 Electron 自带 Chromium 的 `webContents.printToPDF` 渲染——`buildMinutesHtml()` 把 minutes 拼成内联 CSS 的 HTML(所有插值 HTML-escape),在隐藏的、禁用 JS 的 BrowserWindow 里 print 成 PDF,写到 `~/MeetingAI/minutes/*.pdf`。**零新依赖、CJK 用系统字体自动渲染**(双语 app 关键),不需要打包 8MB 中文字体。SummaryView 有"PDF"导出按钮 |
| i18n 多语言 | ❌ 未引入框架 | 渲染层用硬编码 `"English / 中文"` 双语字符串，扩展到日韩需要先引入 i18n 框架 |
| GPL/AGPL 许可证审计 | ✅ Stable | `npm run check-licenses` 已实现 |
| 单元测试 / CI | ✅ Stable | Vitest (`npm test`)、ESLint v9 flat config (`npm run lint`)、`tsc --noEmit` (`npm run typecheck`)、`.github/workflows/ci.yml` 在 push/PR 时跑 typecheck + lint + test + license 审计 |

## ⚠️ 商业合规定位（最重要，贯穿全项目）

本产品的法律定位是：**个人会议笔记辅助工具**。

核心原则：
1. **我们是录音笔记工具，不是会议平台插件** — 不调用任何会议平台（Zoom/Teams/腾讯会议）的 API，不以机器人身份加入会议；当前版本通过 `getUserMedia`（麦克风/Stereo Mix/虚拟音频线缆）或 Electron `getDisplayMedia({audio:'loopback'})`（Windows 10+ 整机系统音频;macOS 仍待 PR #4b 上原生 ScreenCaptureKit 后才有原生路径）捕获,等同于用户自己按下录音键
2. **用户自带一切（纯 BYOK）** — 用户必须使用自己的 AI API Key 和 STT API Key，我们不代理、不转售任何 AI 服务。应用本身是纯工具软件
3. **用户承担录音合规责任** — 首次使用前必须展示法律声明，用户确认知晓并遵守当地录音法规后才能使用
4. **零 GPL 依赖** — 不使用 BlackHole 或任何 GPL 许可的组件，确保闭源商业发布合规

## 项目概述

跨平台（macOS + Windows）桌面应用，用户的「AI 会议笔记助手」。用户参加线上会议时启动本应用：

1. **实时语音转文字** — 捕获用户选择的音频输入（默认麦克风；可手动启用 loopback 捕获系统输出），实时转写为字幕
2. **实时翻译** — 中英双向翻译（可扩展更多语言）
3. **@检测与发言准备** — 检测用户被点名/提问，自动生成回复建议
4. **实时摘要** — 每5分钟提取会议要点
5. **会后纪要** — 结构化文档自动生成（Markdown + Word/.docx + PDF 三种格式均已可用）

## 核心架构原则

### 音频捕获：零第三方驱动

**禁止使用 BlackHole(GPL-3.0)、Soundflower(GPL) 或任何 GPL 许可的虚拟音频驱动。**

| 平台 | 方案 | 当前状态 |
|------|------|---------|
| Windows 10+ | **WASAPI Loopback** (via Electron `setDisplayMediaRequestHandler` + `audio:'loopback'`) | ✅ 已落地 — `electron/main.ts` 注册 handler,`capture.ts` 见到 `SYSTEM_AUDIO_DEVICE_ID` 哨兵 + `backend==='electron-loopback'` 时走 `getDisplayMedia` 分支 |
| Windows 9 及以下 | 不支持 | UI 自动 gray out 系统音频选项;用户走 Stereo Mix |
| macOS 13+ | **ScreenCaptureKit 整机 + 按 app capture**(原生 N-API,`native/macos/audio_tap.mm`) | ✅ 已落地 — ObjC++ N-API 模块直调 ScreenCaptureKit;`capture.ts` `backend==='macos-native'` 时通过 IPC 启动原生捕获并把 PCM 重建成 MediaStream。需用户授权系统录屏权限 |
| macOS 12 及以下 | 不支持 | ScreenCaptureKit 自身要求 macOS 13+;probe 返回 `supported:false`;用户走 `getUserMedia` + 虚拟音频线缆 |
| 所有平台 | **`getUserMedia` 麦克风/Stereo Mix/虚拟音频线缆** | ✅ 已落地 — 始终可作为 fallback 路径 |

系统音频捕获有两个后端,由 `system-audio:probe` 的 `mode` 字段选择:
- **Windows (`electron-loopback`)**:Electron 30+ 官方 `setDisplayMediaRequestHandler` + `audio:'loopback'`,内部就是 WASAPI Loopback。无需 node-gyp 编译。仅整机捕获。
- **macOS (`macos-native`)**:`native/macos/` 的 ObjC++ N-API 模块直调 ScreenCaptureKit。`postinstall` 里 `scripts/build-macos-native.cjs` 编译(非致命:失败则 probe 报 unavailable,降级到虚拟线缆)。整机 **和** 按 app 捕获(per-app 是这条原生路径独有的能力,Electron 包装路径做不到)。纯 N-API (NAPI_VERSION=8) ABI 稳定,system-node 编译的 `.node` 也能在 Electron 30 主进程 load。

> **关键约束:** Electron 30 的官方 typedef 写明 `audio:'loopback'` "currently only supported on Windows" —— 所以 macOS **不能**走 Electron getDisplayMedia 包装路径,必须用原生 N-API 模块(本 PR #4b 落地)。
>
> **安全 hardening (Windows getDisplayMedia 路径):** `setDisplayMediaRequestHandler` 内部三道检查:(1) `request.frame === mainWindow.webContents.mainFrame` —— 拒绝任何 iframe / webview / popup;(2) `request.audioRequested === true` —— 拒绝纯视频请求;(3) `process.platform === 'win32'` —— 即使被信任的 main frame,在非 Windows 上也一律拒绝,防止未来 UI bug 静默泄屏。
>
> **macOS 验证状态:** 原生模块已编译、load、`listApplications` 走通(会触发 TCC 权限对话框,证明确实在调 ScreenCaptureKit)。但**完整的音频捕获质量需要在授予屏幕录制权限的真机上验证** —— 自动化/CI 环境拿不到 TCC 授权,无法端到端验证音质。代码路径、IPC 拼接、PCM→MediaStream 重建逻辑均已就位并通过单测。

### AI 提供商：纯 BYOK 模式

**所有 AI 调用必须使用用户自己的 API Key。严禁在应用中内置任何 API Key 或提供代理服务。**

支持的提供商（用户自选、自付费）：
- **海外**：Claude (Anthropic) / OpenAI GPT / Google Gemini
- **通用**：DeepSeek（国内外均可）
- **国内**：通义千问(Qwen) / MiniMax / 智谱(GLM)

**没有"免费试用"或"内置 AI"选项。** 未配置 AI Key 时，AI 功能（翻译/摘要/发言建议）显示为灰色"未启用"状态。实时转写有四个引擎可选:Deepgram(流式)、OpenAI Whisper API(5 秒分段)、讯飞(PCM 流式) 三个云端 BYOK 引擎,以及 **Local Whisper(离线,whisper.cpp,无需 Key,需先在设置中下载模型)**。只有原始音频录制可以完全无引擎工作。

**收费模式：** 软件本身收费（一次性购买或订阅），AI 和 STT 费用由用户直接向对应服务商支付。

### STT 引擎选型（合规优先）

| 引擎 | 许可证 | 商用合规 | 实现状态 |
|------|--------|---------|---------|
| Deepgram | 商业 API（BYOK） | ✅ 用户自己付费 | ✅ Stable |
| OpenAI Whisper API | 商业 API（BYOK） | ✅ 用户自己付费 | ✅ Stable — segment 模式 (5 秒分段) |
| 讯飞语音 | 商业 API（BYOK） | ✅ 用户自己付费 | ✅ Stable — `xfyun-signature.ts` 实现 HMAC-SHA256 (WebCrypto),`audioMode='pcm-stream'` 走 AudioWorklet PCM 管线 |
| 阿里语音 | 商业 API（BYOK） | ✅ 用户自己付费 | ❌ 尚未实现，已暂时从 `STTEngineId` 类型中移除 |
| whisper.cpp (本地,via smart-whisper) | **MIT 许可** | ✅ 可安全嵌入分发 | 🟡 Beta — `smart-whisper` (MIT) N-API binding;`local-whisper.ts` 走 pcm-stream 窗口化 + IPC 到主进程转写;模型按需下载。转写核心已端到端验证 |

> **whisper.cpp** 是 Georgi Gerganov 用 C/C++ 重写的 Whisper 推理引擎，MIT 许可，可安全嵌入闭源商业产品。本地运行，零网络依赖，隐私最佳。已通过 `smart-whisper`(MIT,只依赖 node-addon-api,vendors whisper.cpp,作为 optionalDependency — 构建失败不阻断 `npm install`,loader 容错报 unavailable)集成到主进程。模型(ggml `.bin`,MIT)按需从 HuggingFace 下载到 `userData/whisper-models`。smart-whisper 自带 install 钩子编译 whisper.cpp;`postinstall` 的 `electron-rebuild -w better-sqlite3,smart-whisper` 再针对 Electron ABI 重建一次,确保打包产物在 Electron 主进程能 load(虽然 N-API 本身 ABI 稳定,但显式 rebuild 消除任何 ABI 疑虑)。注:CI 的 verify job 用 `npm ci --ignore-scripts`,故 CI 不构建原生模块,单测全部用注入的 fake loader;原生构建只在真正的 release(electron-builder)流程跑。**转写核心已用 tiny 模型 + JFK 样本端到端验证通过**。

### Electron 构建：排除 GPL ffmpeg

Electron 本身是 MIT 许可，可商用。但内置 Chromium 的 ffmpeg 包含专利编解码器需注意。

解决方案：
1. 本项目音频处理使用 Web Audio API + 原生模块，**不依赖 Electron 内置 ffmpeg**
2. 录音输出为 WAV（无编解码需求）或 Opus（BSD 许可编码器）
3. 在 electron-builder afterPack 钩子中替换为自由编解码器版本
4. 添加 `scripts/check-licenses.js` 审计脚本

## 法律声明系统

### 首次启动法律声明（LegalDisclaimer 组件）

在引导流程最前面，用户必须阅读并同意以下声明后才能继续。**最终展示文案以 `src/config/legal-texts.ts` 中的当前版本为准**；下面这一段只是结构示例：

```
法律声明与使用条款（示例 — 实际文案见 src/config/legal-texts.ts）

1. 录音合规责任
本应用通过您在操作系统中选择的音频输入设备（默认为麦克风）进行录制。
如需同时录制其他参与者的声音，需要在系统层启用 loopback（Windows: Stereo Mix；
macOS: 非 GPL 虚拟音频线缆），并在应用内选择该设备。Windows 10+ 用户也
可在设置中启用"System Audio (native loopback)"使用 Electron 包装的
WASAPI loopback(无需 Stereo Mix);macOS 13+ 用户启用同一开关使用原生
ScreenCaptureKit(需授权系统录屏权限,支持按 app 捕获)。
您有责任确保：
- 已遵守您所在地区关于录音的法律法规
- 已获得所有会议参与者的知情同意（如适用法律要求）
- 不会将录音用于违反他人隐私权的目的
不同地区的录音法律差异很大，违反可能构成违法行为。

2. 数据处理说明
- 本地存储：录音文件、转写记录、设置和加密 API Key 仅保存在您的设备
- 外发流量：实时转写音频发往您选择的 STT 服务商；AI 翻译/摘要/建议文本
  发往您选择的 AI 服务商；API Key 作为认证凭据随请求发送给对应服务商
- MeetU 不运行任何服务器，不接收、不存储、不代理上述任何内容

3. 免责声明
本软件是个人笔记辅助工具。使用本软件产生的一切法律后果
由用户自行承担。软件提供方不对用户的使用方式承担法律责任。

□ 我已阅读并理解以上条款，同意自行承担录音合规责任
```

### 每次录音前提醒（RecordingConsent 组件）

每次点击"开始录音"时，短暂显示："请确保已获得参会者同意录音"，带"我已确认"按钮。

### 导出文档免责

会议纪要底部附加："本纪要由 AI 辅助生成，内容仅供参考，请核实关键信息。"

## 技术栈许可证审计

| 技术 | 许可证 | 商用状态 |
|---|---|---|
| Electron 30+ | MIT | ✅ 安全 |
| React 18 | MIT | ✅ 安全 |
| TypeScript | Apache-2.0 | ✅ 安全 |
| Zustand | MIT | ✅ 安全 |
| Tailwind CSS 3 | MIT | ✅ 安全 |
| Vite | MIT | ✅ 安全 |
| electron-builder | MIT | ✅ 安全 |
| better-sqlite3 | MIT | ✅ 安全 |
| electron-store | MIT | ✅ 安全 |
| whisper.cpp | MIT | ✅ 安全 |
| libopus | BSD-3-Clause | ✅ 安全 |
| ws (WebSocket) | MIT | ✅ 安全 |
| docx (docx-js) | MIT | ✅ 安全 |
| lucide-react | ISC | ✅ 安全 |

> `docx` (docx-js, MIT) 已在 Word 导出真实实现后重新加回(见 `electron/export/docx-generator.ts`)。PDF 导出**不依赖任何 PDF 库**——用 Electron 自带的 `webContents.printToPDF`(Chromium),所以 `pdfkit` 等依赖始终不需要,且 CJK 由系统字体渲染,无需打包字体文件。

> **禁止清单：** BlackHole(GPL-3.0)、Soundflower(GPL)、ffmpeg CLI(GPL)、任何 GPL/AGPL 库。引入新依赖前必须运行 `npm run check-licenses`。

## 目录结构

```
meetu/
├── CLAUDE.md                          ← 你正在读的文件
├── LICENSE                            ← 商业许可证
├── LEGAL_NOTICE.md                    ← 第三方许可证归属
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.js
├── native/                            # ⭐ 原生音频模块（零 GPL）
│   └── macos/                          # ScreenCaptureKit 系统音频捕获 (PR #4b)
│       ├── audio_tap.mm               # ObjC++ N-API 模块：直调 ScreenCaptureKit
│       ├── binding.gyp                # node-gyp 构建配置 (NAPI_VERSION=8)
│       ├── index.cjs                  # JS loader：容错地 require .node
│       └── index.d.ts                 # loader 的 TS 类型
│       # Windows 系统音频走 Electron getDisplayMedia 包装路径,
│       # 无需原生模块,所以没有 native/windows/。
├── electron/
│   ├── main.ts                        # Electron 主进程入口
│   ├── preload.ts                     # contextBridge
│   ├── audio/
│   │   ├── capture-manager.ts         # 跨平台音频管理器
│   │   └── recorder.ts               # WAV 录音器
│   └── ipc/
│       └── channels.ts
├── src/
│   ├── App.tsx
│   ├── components/
│   │   ├── LegalDisclaimer.tsx        # ⭐ 首次法律声明
│   │   ├── RecordingConsent.tsx       # ⭐ 录音前同意
│   │   ├── OnboardingWizard.tsx       # 引导流程（纯 BYOK）
│   │   ├── Header.tsx
│   │   ├── TabBar.tsx
│   │   └── MentionAlert.tsx
│   ├── views/
│   │   ├── TranscriptView.tsx
│   │   ├── TranslationView.tsx
│   │   ├── SpeechAssistView.tsx
│   │   └── SummaryView.tsx
│   ├── services/
│   │   ├── ai-provider/               # 全部 BYOK
│   │   │   ├── types.ts
│   │   │   ├── provider-registry.ts
│   │   │   ├── claude-provider.ts
│   │   │   ├── openai-provider.ts
│   │   │   ├── gemini-provider.ts
│   │   │   ├── deepseek-provider.ts
│   │   │   ├── qwen-provider.ts
│   │   │   ├── minimax-provider.ts
│   │   │   ├── glm-provider.ts
│   │   │   ├── openai-compatible-base.ts
│   │   │   └── index.ts
│   │   ├── stt-engine/
│   │   │   ├── types.ts
│   │   │   ├── engine-registry.ts
│   │   │   ├── deepgram-engine.ts     # BYOK
│   │   │   ├── whisper-api-engine.ts  # BYOK
│   │   │   ├── xfyun-engine.ts       # BYOK
│   │   │   └── local-whisper.ts       # 离线 whisper.cpp (smart-whisper)，pcm-stream 窗口化 → IPC
│   │   ├── translation.ts
│   │   ├── mention-detector.ts
│   │   ├── speech-advisor.ts
│   │   ├── summarizer.ts
│   │   └── post-meeting.ts
│   ├── stores/
│   │   ├── meeting-store.ts
│   │   ├── settings-store.ts          # 含法律同意状态
│   │   └── transcript-store.ts
│   └── config/
│       ├── prompts.ts
│       └── legal-texts.ts            # ⭐ 法律声明文本
├── scripts/
│   ├── check-licenses.js             # ⭐ 依赖许可证审计
│   └── replace-ffmpeg.js             # ⭐ 替换 GPL ffmpeg
└── database/
    └── schema.sql
```

## 开发顺序

### Phase 0: 项目初始化 + 合规框架
1. 项目骨架搭建（Vite + Electron + React + TS + Tailwind）
2. 实现 `scripts/check-licenses.js`，运行确保零 GPL 依赖
3. 配置 electron-builder 使用自由 ffmpeg
4. **实现 LegalDisclaimer 组件**
5. **实现 RecordingConsent 组件**

### Phase 1: 纯 BYOK 设置系统
1. 实现 AI Provider 接口和注册中心
2. 实现全部 7 个 AI Provider
3. 引导流程：法律声明 → 选区域 → 选 AI → 输入 Key → 测试
4. **未配置 Key 时 AI 功能灰色不可用，显示"请先配置 API Key"**
5. 实现 STT 引擎选择（含本地 whisper.cpp 离线方案）

### Phase 2: 音频捕获 + 录音（零 GPL 依赖）
1. Windows: 整机 WASAPI loopback (Electron `setDisplayMediaRequestHandler` + `audio:'loopback'`,无需 N-API,PR #4a 已上线)
2. macOS: ScreenCaptureKit 整机 + per-app capture(原生 ObjC++ N-API,`native/macos/audio_tap.mm`,PR #4b 已上线)
3. 双通道音频流（系统音频 + 麦克风）
4. WAV 录音（Web Audio API，不依赖 ffmpeg）
5. 每次录音前显示 RecordingConsent

### Phase 3-6: 同之前 PRD

## 发布前合规检查清单

- [ ] `npm run check-licenses` 输出零 GPL/AGPL 依赖
- [ ] Electron ffmpeg 已替换为自由编解码器版本
- [ ] 首次启动法律声明已实现并要求明确同意
- [ ] 每次录音前有合规提醒
- [ ] 代码中无任何内置 API Key（`grep -r "sk-\|key-ant\|AIza" src/ electron/`）
- [ ] 导出文档有 AI 生成免责声明
- [ ] 营销材料不含"Zoom 插件""Teams 集成"等措辞
- [ ] LEGAL_NOTICE.md 包含所有第三方许可证归属
- [ ] 用户协议/EULA 由律师审核
- [ ] **真机验证** —— 按 `docs/MANUAL_VERIFICATION.md` 逐项确认 CI 覆盖不到的功能(macOS 系统音频、Local Whisper 完整链路、Windows loopback、云端 STT 真 Key)

## 营销定位指南

**✅ 可以说：** "AI 会议笔记助手"、"个人会议记录工具"、"实时转写和翻译助手"、"支持接入多种 AI 服务"、"你的 AI，你的笔记"

**❌ 不能说：** "Zoom 插件/集成"、"Teams 扩展"、"自动加入会议"、"内置 AI / 免费 AI"、"代替你参加会议"
