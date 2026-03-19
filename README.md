<p align="center">
  <img src="resources/icons/logo.svg" width="128" height="128" alt="MeetU Logo">
</p>

<h1 align="center">MeetU / 开会啦</h1>

<p align="center">
  <strong>Your AI Meeting Copilot / 你的 AI 会议副驾</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-BSL--1.1-blue" alt="License">
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey" alt="Platform">
  <img src="https://img.shields.io/badge/languages-EN%20%7C%20中文-green" alt="Languages">
  <img src="https://img.shields.io/badge/AI-BYOK-orange" alt="BYOK">
</p>

---

## What is MeetU? / MeetU 是什么？

MeetU is a cross-platform desktop app that sits beside your meeting window, providing real-time transcription, translation, and AI-powered assistance — all using **your own API keys** (BYOK). Your data never touches our servers.

MeetU 是一款跨平台桌面应用，在你开会时提供实时转写、翻译和 AI 辅助功能。采用 BYOK 模式（自带 API Key），数据完全不经过我们的服务器。

## Features / 核心功能

| Feature | Description |
|---------|-------------|
| 🎙️ **Real-time Transcription** / 实时转写 | Live speech-to-text with speaker identification and multi-language support |
| 🌐 **Live Translation** / 实时翻译 | Automatic EN↔中 translation with custom glossary support |
| 🔔 **@Mention Detection** / @检测提醒 | Instantly alerts you when someone calls your name or asks you a question |
| 💡 **Smart Speech Suggestions** / 智能发言建议 | AI generates 3 reply strategies (conservative / assertive / diplomatic) when you're @'d |
| 📋 **Real-time Summary** / 实时摘要 | Key points, decisions, and action items extracted every few minutes |
| 📄 **Meeting Minutes Export** / 会后纪要导出 | Structured minutes auto-generated on meeting end, exportable as Markdown or Word |

## How It Works / 工作原理

```
┌─────────────┐    ┌──────────────┐    ┌────────────────┐
│ System Audio │───>│ STT Engine   │───>│ AI Provider    │
│ + Microphone │    │ (Your Key)   │    │ (Your Key)     │
└─────────────┘    └──────┬───────┘    └───────┬────────┘
                          │                     │
                     Transcript            Translation
                     + Captions          + Summary + Tips
                          │                     │
                          └─────────┬───────────┘
                                    │
                          ┌─────────▼─────────┐
                          │  Local SQLite DB   │
                          │  (Your device only)│
                          └───────────────────┘
```

**Key architecture principles:**
- **BYOK (Bring Your Own Key)** — You use your own AI & STT API keys. We never see them.
- **Local-first** — Audio, transcripts, and settings stored on your device only.
- **Zero GPL** — All dependencies are commercially safe (MIT/BSD/Apache-2.0).
- **No cloud dependency** — The app works offline with local Whisper STT (coming soon).

## Supported Providers / 支持的服务商

### AI Providers

| Provider | Region | Models |
|----------|--------|--------|
| Claude (Anthropic) | Global | Sonnet 4, Haiku 4.5, Opus 4.6 |
| OpenAI GPT | Global | GPT-4o, GPT-4o Mini, o3-mini |
| Google Gemini | Global | Gemini 2.0 Flash, Gemini 2.5 Pro |
| DeepSeek | Global + China | DeepSeek-V3, DeepSeek-R1 |
| Qwen (Alibaba) | Global + China | Qwen Plus, Turbo, Max |
| MiniMax | China | MiniMax-Text-01 |
| Zhipu GLM | China | GLM-4 Flash, GLM-4 Plus |

### STT Engines

| Engine | Region | Type |
|--------|--------|------|
| Deepgram | Global | Real-time WebSocket |
| Whisper API (OpenAI) | Global | Segment-based REST |
| iFlytek | China | Real-time WebSocket |
| Alibaba Speech | China | Real-time WebSocket |
| Local Whisper | Offline | whisper.cpp (MIT) |

## Quick Start / 快速开始

### Prerequisites / 前置条件

- **macOS 13+** or **Windows 10+**
- **Node.js 18+**
- At least one AI provider API Key (e.g., DeepSeek, OpenAI, Claude)
- Optionally, an STT engine API Key (e.g., Deepgram)

### Installation / 安装

```bash
git clone https://github.com/jessecu2024/meeting-ai-assistant.git
cd meeting-ai-assistant
npm install
npm run dev
```

### Build / 构建发布版

```bash
npm run build              # Build for current platform
npm run electron:build     # Build for macOS + Windows
```

## Privacy & Security / 隐私与安全

MeetU is designed with privacy as a core principle:

- **All data stays on your device** — audio recordings, transcripts, settings, and API keys are stored locally only
- **API keys are encrypted** at rest using your OS's secure storage (Electron safeStorage)
- **No telemetry, no analytics, no tracking** — we collect zero data about you
- **No cloud backend** — the app communicates only with the AI/STT providers you choose
- **Source code is auditable** — you can verify exactly what the app does

MeetU 以隐私为核心设计原则：所有数据仅存储在本地，API Key 使用操作系统级加密，零遥测零追踪，无云后端，源码可审计。

## Legal Notice / 法律声明

MeetU is a **personal note-taking tool**. Users are responsible for complying with local recording laws and obtaining participant consent where required. See [LEGAL_NOTICE.md](LEGAL_NOTICE.md) for full details.

MeetU 是个人笔记辅助工具。用户有责任遵守当地录音法律并获取参与者同意。

## License / 许可证

MeetU is licensed under the **Business Source License 1.1**. See [LICENSE](LICENSE) for the full text.

**In short:**
- Personal, educational, and internal company use: **Free**
- Building a competing commercial product: **Requires a commercial license**
- After 2029-03-19: **Automatically becomes MIT** (fully open source)

See [LICENSE-FAQ.md](LICENSE-FAQ.md) for details.

## Contributing / 贡献

We welcome contributions! Please note:

1. By submitting a PR, you agree that your contribution is licensed under the same BSL 1.1 terms
2. For significant contributions, we may ask you to sign a Contributor License Agreement (CLA)
3. Please open an issue first for large changes to discuss the approach

## Roadmap / 路线图

- [ ] Local Whisper (whisper.cpp) integration for fully offline STT
- [ ] macOS ScreenCaptureKit native audio capture
- [ ] Multi-language support beyond EN/中 (Japanese, Korean, etc.)
- [ ] Meeting history browser with search
- [ ] Plugin system for custom AI workflows
- [ ] Mobile companion app for meeting review

## Contact / 联系

- GitHub Issues: [github.com/jessecu2024/meeting-ai-assistant/issues](https://github.com/jessecu2024/meeting-ai-assistant/issues)
- Email: meetu.app@outlook.com

---

<p align="center">
  <sub>Built with Electron + React + TypeScript. Zero GPL dependencies.</sub>
</p>
