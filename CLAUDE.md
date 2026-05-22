# MeetU (开会啦) — Claude Code 开发指南

## 当前实现状态（v1.1.0，最新一次审计：2026-05-21）

下面这张表反映**代码实际状态**，不是路线图。改 README、CLAUDE.md 或营销材料前先看这里。

| 模块 | 状态 | 说明 |
|------|------|------|
| 麦克风录音（`getUserMedia`） | ✅ Stable | 单声道麦克风 + Windows Stereo Mix / macOS 虚拟声卡 loopback 路径走通 |
| macOS ScreenCaptureKit 原生捕获 | 🔜 Planned | `native/macos/` 有 Swift 草稿与 binding.gyp，但 `audio_tap.mm` 的 N-API 绑定仍是 placeholder，未参与构建 |
| Windows WASAPI Loopback 原生捕获 | 🔜 Planned | `native/windows/` 尚未创建 |
| Deepgram STT | ✅ Stable | WebSocket 经主进程 IPC，已可用 |
| OpenAI Whisper API STT | ✅ Stable | 引擎以 segment 模式 (`audioMode='segment'`, `segmentDurationMs=5000`) 工作;capture.ts 用并行 MediaRecorder 每 5 秒产出一个完整 webm 文件直接 POST `/v1/audio/transcriptions`;内置 hallucination 过滤丢弃 silence 时的 "Thank you for watching" / 字幕组 类幻觉 |
| 讯飞 STT | ✅ Stable | WebSocket 鉴权:`xfyun-signature.ts` 用 WebCrypto API 计算 HMAC-SHA256;音频管线:`audioMode='pcm-stream'`,capture.ts 启 AudioWorklet 输出 16-kHz 单声道 Float32 PCM,engine 内部转 Int16 + base64 发 `audio/L16;rate=16000` 帧 |
| 阿里语音 STT | ❌ Removed | 之前列在文档/类型中，但代码从未实现，已从 `STTEngineId` 移除 |
| Local Whisper (whisper.cpp) | 🔜 Planned | `local-whisper.ts` 为 stub，`feedAudio`/`stopSession` 是 TODO |
| 所有 7 个 AI Provider (Claude/OpenAI/Gemini/DeepSeek/Qwen/MiniMax/GLM) | ✅ Stable | OpenAI 兼容协议 + Gemini 特例 |
| Markdown 纪要导出 | ✅ Stable | 主进程写 `~/MeetingAI/minutes/*.md` |
| Word (.docx) 纪要导出 | ✅ Stable | `electron/export/docx-generator.ts` 使用 `docx@^8` 在主进程生成 Word 文档（标题/摘要/讨论议题/Action Items 表格/未解决问题/下一步/免责声明），renderer 通过 `file:export` IPC 传 minutes payload，主进程写到 `~/MeetingAI/minutes/*.docx` |
| PDF 纪要导出 | ❌ Not planned right now | 此前装的 `pdfkit` 依赖已删除（曾在 `package.json` 但全代码 0 引用）；如未来需要 PDF 导出，请再添加依赖并真实现 |
| i18n 多语言 | ❌ 未引入框架 | 渲染层用硬编码 `"English / 中文"` 双语字符串，扩展到日韩需要先引入 i18n 框架 |
| GPL/AGPL 许可证审计 | ✅ Stable | `npm run check-licenses` 已实现 |
| 单元测试 / CI | ✅ Stable | Vitest (`npm test`)、ESLint v9 flat config (`npm run lint`)、`tsc --noEmit` (`npm run typecheck`)、`.github/workflows/ci.yml` 在 push/PR 时跑 typecheck + lint + test + license 审计 |

## ⚠️ 商业合规定位（最重要，贯穿全项目）

本产品的法律定位是：**个人会议笔记辅助工具**。

核心原则：
1. **我们是录音笔记工具，不是会议平台插件** — 不调用任何会议平台（Zoom/Teams/腾讯会议）的 API，不以机器人身份加入会议；当前版本通过 `getUserMedia` 捕获用户在系统中选择的音频输入设备（默认麦克风；用户可手动启用 Stereo Mix / 虚拟音频线缆以捕获系统输出），等同于用户自己按下录音键
2. **用户自带一切（纯 BYOK）** — 用户必须使用自己的 AI API Key 和 STT API Key，我们不代理、不转售任何 AI 服务。应用本身是纯工具软件
3. **用户承担录音合规责任** — 首次使用前必须展示法律声明，用户确认知晓并遵守当地录音法规后才能使用
4. **零 GPL 依赖** — 不使用 BlackHole 或任何 GPL 许可的组件，确保闭源商业发布合规

## 项目概述

跨平台（macOS + Windows）桌面应用，用户的「AI 会议笔记助手」。用户参加线上会议时启动本应用：

1. **实时语音转文字** — 捕获用户选择的音频输入（默认麦克风；可手动启用 loopback 捕获系统输出），实时转写为字幕
2. **实时翻译** — 中英双向翻译（可扩展更多语言）
3. **@检测与发言准备** — 检测用户被点名/提问，自动生成回复建议
4. **实时摘要** — 每5分钟提取会议要点
5. **会后纪要** — 结构化文档自动生成（Markdown + Word/.docx 均已可用；PDF 目前不打算实现）

## 核心架构原则

### 音频捕获：零第三方驱动

**禁止使用 BlackHole(GPL-3.0)、Soundflower(GPL) 或任何 GPL 许可的虚拟音频驱动。**

| 平台 | 目标方案 | 当前状态 |
|------|---------|---------|
| macOS 13+ | **ScreenCaptureKit** | 🔜 计划中 — `native/macos/` 已有 Swift 草稿和 binding.gyp，但 N-API 绑定 (`audio_tap.mm`) 仍是占位符；运行时尚未挂载 |
| macOS 12及以下 | 暂不支持 | 要求最低 macOS 13 Ventura |
| Windows 10+ | **WASAPI Loopback** | 🔜 计划中 — `native/windows/` 尚未创建 |
| 当前所有平台 | **`getUserMedia` 麦克风 + loopback 指引** | ✅ 已落地 — 渲染层使用 `navigator.mediaDevices.getUserMedia`，UI 引导用户在 Windows 启用 Stereo Mix 或在 macOS 路由虚拟音频线缆 |

macOS ScreenCaptureKit 是目标方案：Apple 官方 API 无许可证问题；可选择捕获特定应用（如 Zoom）的音频而非全系统；不需要用户安装任何额外驱动；macOS 13+ 覆盖主流用户群。

> **开发注意：** ScreenCaptureKit 需通过 Node.js 原生模块（N-API addon）在 Electron 主进程中调用 Swift/ObjC 代码。`native/macos/` 已有目录骨架，但 `audio_tap.mm` 中的 N-API 绑定仍为 TODO，需要补全后才能真正捕获系统音频。在此之前，README 与 UI 不应承诺"系统音频自动捕获"。

### AI 提供商：纯 BYOK 模式

**所有 AI 调用必须使用用户自己的 API Key。严禁在应用中内置任何 API Key 或提供代理服务。**

支持的提供商（用户自选、自付费）：
- **海外**：Claude (Anthropic) / OpenAI GPT / Google Gemini
- **通用**：DeepSeek（国内外均可）
- **国内**：通义千问(Qwen) / MiniMax / 智谱(GLM)

**没有"免费试用"或"内置 AI"选项。** 未配置 AI Key 时，AI 功能（翻译/摘要/发言建议）显示为灰色"未启用"状态。当前版本下，**实时转写需要配置 Deepgram(流式)、OpenAI Whisper API(5 秒分段) 或讯飞(PCM 流式) 之一**;只有原始音频录制可以完全无 Key 工作。Local Whisper 仍在路线图中。

**收费模式：** 软件本身收费（一次性购买或订阅），AI 和 STT 费用由用户直接向对应服务商支付。

### STT 引擎选型（合规优先）

| 引擎 | 许可证 | 商用合规 | 实现状态 |
|------|--------|---------|---------|
| Deepgram | 商业 API（BYOK） | ✅ 用户自己付费 | ✅ Stable |
| OpenAI Whisper API | 商业 API（BYOK） | ✅ 用户自己付费 | ✅ Stable — segment 模式 (5 秒分段) |
| 讯飞语音 | 商业 API（BYOK） | ✅ 用户自己付费 | ✅ Stable — `xfyun-signature.ts` 实现 HMAC-SHA256 (WebCrypto),`audioMode='pcm-stream'` 走 AudioWorklet PCM 管线 |
| 阿里语音 | 商业 API（BYOK） | ✅ 用户自己付费 | ❌ 尚未实现，已暂时从 `STTEngineId` 类型中移除 |
| whisper.cpp (本地) | **MIT 许可** | ✅ 可安全嵌入分发 | 🔜 Planned — `local-whisper.ts` 是 stub，`feedAudio` / `stopSession` 仍是 TODO |

> **whisper.cpp** 是 Georgi Gerganov 用 C/C++ 重写的 Whisper 推理引擎，MIT 许可，可安全嵌入闭源商业产品。本地运行，零网络依赖，隐私最佳。**目标**是作为离线兜底方案，但当前版本只有接口骨架，尚未集成 WASM/native 二进制；用户必须配置至少一个云端 STT Key 才能转写。

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
macOS: 非 GPL 虚拟音频线缆），并在应用内选择该设备。原生 ScreenCaptureKit /
WASAPI Loopback 在路线图中尚未发布。
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

> `pdfkit` (MIT) 之前列在此表中,但因 PDF 导出未实现已删除,避免幽灵 dep。`docx` (docx-js, MIT) 已在 Word 导出真实实现后重新加回(见 `electron/export/docx-generator.ts`)。

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
│   ├── macos/
│   │   ├── screencapture.swift        # ScreenCaptureKit Swift 封装
│   │   ├── audio_tap.mm              # Objective-C++ 桥接
│   │   └── binding.gyp
│   └── windows/
│       ├── wasapi_loopback.cpp        # WASAPI C++ 封装
│       └── binding.gyp
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
│   │   │   └── local-whisper.ts       # MIT，可嵌入
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
1. macOS: 实现 ScreenCaptureKit N-API 原生模块
2. Windows: 实现 WASAPI Loopback N-API 原生模块
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

## 营销定位指南

**✅ 可以说：** "AI 会议笔记助手"、"个人会议记录工具"、"实时转写和翻译助手"、"支持接入多种 AI 服务"、"你的 AI，你的笔记"

**❌ 不能说：** "Zoom 插件/集成"、"Teams 扩展"、"自动加入会议"、"内置 AI / 免费 AI"、"代替你参加会议"
