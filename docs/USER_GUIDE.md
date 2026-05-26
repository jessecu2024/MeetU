# MeetU (开会啦) 用户指南 / User Guide

> **Version 1.1.0** | 最后更新 / Last Updated: 2026-05-21

---

## 目录 / Table of Contents

1. [简介 / Introduction](#简介--introduction)
2. [系统要求 / System Requirements](#系统要求--system-requirements)
3. [安装 / Installation](#安装--installation)
4. [首次启动 / First Launch](#首次启动--first-launch)
5. [主界面 / Main Interface](#主界面--main-interface)
6. [录音与转写 / Recording & Transcription](#录音与转写--recording--transcription)
7. [实时翻译 / Real-time Translation](#实时翻译--real-time-translation)
8. [@检测与发言建议 / Mention Detection & Speech Suggestions](#检测与发言建议--mention-detection--speech-suggestions)
9. [实时摘要 / Real-time Summary](#实时摘要--real-time-summary)
10. [会议纪要导出 / Meeting Minutes Export](#会议纪要导出--meeting-minutes-export)
11. [设置 / Settings](#设置--settings)
12. [常见问题 / FAQ](#常见问题--faq)
13. [快捷操作提示 / Tips](#快捷操作提示--tips)

---

## 简介 / Introduction

**MeetU（开会啦）** 是一款跨平台桌面 AI 会议助手。在线上会议期间运行本应用，即可获得：

- **实时语音转文字** — 转写你选择的音频输入设备(默认麦克风);要捕获会议中其他参与者的声音,可选择 macOS 13+ / Windows 10+ 的**系统音频 loopback**(原生 ScreenCaptureKit / WASAPI,无需驱动),或在系统层启用 Stereo Mix / 虚拟音频线缆作为输入
- **实时翻译** — 中英双向即时翻译
- **@检测与智能回复建议** — 检测到有人叫你时，自动生成三种风格的回复建议
- **实时摘要** — 每隔几分钟自动提取会议要点
- **会后纪要导出** — 自动生成结构化会议纪要，可导出为 Markdown 或 Word (.docx)

### BYOK（自带 Key）模式

MeetU 采用 **100% BYOK** 模式：
- 你使用自己的 AI API Key（Claude / OpenAI / DeepSeek 等）
- 你使用自己的语音转文字 API Key（Deepgram 流式 / OpenAI Whisper API 5 秒分段 / 讯飞 PCM 流式，三选一；Local Whisper 在路线图中）
- **所有数据存储在本地**，音频和文字不会发送到 MeetU 的服务器
- AI 请求直接从你的设备发送到你选择的 AI 服务商

---

## 系统要求 / System Requirements

| 项目 | 要求 |
|------|------|
| 操作系统 | Windows 10+ 或 macOS 13+ (Ventura) |
| 内存 | 建议 4GB+ |
| 网络 | 使用在线 AI/STT 服务时需要网络连接 |
| STT API Key | **必需**：Deepgram 或 OpenAI Whisper API Key 之一（用于实时转写） |
| AI API Key | 至少一个 AI 提供商的 Key（用于翻译/摘要/建议功能） |

> 计划中的离线 Local Whisper 引擎尚未发布；当前版本必须配置一个云端 STT Key 才能完成实时转写，否则应用会退回到 demo/mock 转写。

---

## 安装 / Installation

### 方法一：下载安装包（推荐）

前往 [GitHub Releases](https://github.com/jessecu2024/MeetU/releases) 下载最新版本。

**Windows 用户：**
1. 下载 `MeetU-Setup-1.1.0.exe` 安装程序
2. 双击运行，按提示完成安装
3. 从开始菜单或桌面快捷方式启动 MeetU

**macOS 用户：**
1. 下载 `MeetU-1.1.0.dmg`
2. 打开 DMG，将 MeetU 拖入 Applications 文件夹
3. 首次打开时，如遇到"无法验证开发者"提示，请在 **系统设置 → 隐私与安全性** 中点击"仍要打开"
4. macOS 会提示授予麦克风权限（用于录音），请允许。**首次选择"System Audio (native loopback)"时,系统会要求授予屏幕与系统录制权限** — 在 *系统设置 → 隐私与安全 → 屏幕与系统录制* 中授权后重启应用方可生效

### 方法二：从源码构建

```bash
git clone https://github.com/jessecu2024/MeetU.git
cd MeetU
npm install
npm run dev          # 开发模式
npm run build        # 构建发布版
```

---

## 首次启动 / First Launch

首次启动时，需要完成 **引导流程（7 步）**：

### 步骤 1：法律声明（必须同意）

阅读并同意以下内容后才能继续：
- **录音合规责任** — 你需要确保遵守当地录音法律并获取参会者同意
- **数据处理说明** — 音频存储在本地，AI 文本发送至你选择的服务商
- **免责声明** — 软件是个人笔记辅助工具

需要滚动到底部，勾选同意框后点击"同意并继续"。

### 步骤 2：选择网络区域

- **海外网络（Global）** — 可使用 OpenAI、Claude、Google Gemini、Deepgram 等
- **中国大陆（China）** — 推荐使用 DeepSeek、通义千问、智谱 GLM 等

### 步骤 3：选择 AI 提供商

| 区域 | 推荐 | 备选 |
|------|------|------|
| 海外 | Claude (Anthropic) | OpenAI GPT, Google Gemini, DeepSeek |
| 中国 | DeepSeek | 通义千问 (Qwen), 智谱 GLM, MiniMax |

每个提供商会显示名称、描述、定价信息和可用性标记。

### 步骤 4：输入 API Key

- 输入你的 AI API Key（从服务商官网获取）
- Key 会使用系统安全存储加密保存在本地
- **可以跳过此步骤**，但 AI 功能（翻译、摘要、发言建议）将不可用

### 步骤 5：连接测试

- 点击"测试连接"验证 API Key 是否有效
- 成功后会显示绿色勾号和延迟时间
- 失败时可查看错误信息并重试

### 步骤 6：选择语音转文字引擎

| 引擎 | 说明 | 状态 |
|------|------|------|
| Deepgram | 实时 WebSocket 流式转写，延迟低 | ✅ Stable |
| Whisper API | OpenAI 的语音识别 API (5 秒分段) | ✅ Stable |
| 讯飞语音 | 国内 PCM 流式语音识别（最佳中文识别） | ✅ Stable |
| 本地 Whisper | 离线运行，MIT 许可 | 🔜 Planned — whisper.cpp 集成尚未发布，UI 中已禁用 |

> 阿里语音 (Paraformer) 之前列在此处但尚未实现，已暂时从代码中移除。

### 步骤 7：填写个人信息

- **中文姓名**（如：张明）
- **英文姓名**（如：Michael Zhang）
- **职位/角色**（如：产品经理）

这些信息用于检测会议中有人叫你名字时触发提醒。所有数据仅存储在本地。

---

## 主界面 / Main Interface

### 顶部栏

- **应用标题**：MeetU / 开会啦
- **录音按钮**：蓝色"录音 / Record"（录音中变为红色"停止 / Stop"）
- **录音计时器**：显示录音时长（MM:SS 或 HH:MM:SS）
- **REC 指示灯**：录音中显示红色闪烁圆点
- **音量指示器**：绿色→黄色→红色 表示音量大小
- **音频状态**：当前所选输入设备的状态（绿色显示设备名 + ✓ 表示正常采集；红色 ✗ 表示无音频）。如启用了 Stereo Mix / 虚拟音频线缆作为输入设备，这一栏会显示该 loopback 设备名
- **设置按钮**：⚙ 图标
- **窗口控制**：最小化、关闭

### 标签导航（4 个标签页）

| 标签 | 功能 | 是否需要 AI |
|------|------|------------|
| **Transcript / 转写** | 实时语音转文字 | 否 |
| **Translation / 翻译** | 实时中英翻译 | 是 |
| **Speech / 发言** | @检测与回复建议 | 是 |
| **Summary / 摘要** | 实时摘要与会议纪要 | 是 |

> **提示**：未配置 AI Key 时，翻译、发言、摘要标签页会显示为灰色，并提示"请先配置 API Key"，点击即可跳转到设置。

---

## 录音与转写 / Recording & Transcription

### 开始录音

1. 点击顶部的 **"录音 / Record"** 按钮
2. 弹出录音合规确认对话框，点击 **"我已确认 / Confirm"**
3. 系统开始捕获音频并实时转写

> 可在确认对话框中勾选"不再提示"以跳过后续确认。

### 音频捕获方式

应用有两条录音路径,在 设置 → 偏好设置 → 音频输入设备 中选择:

1. **系统音频 loopback（推荐,无需驱动）** — 录制整个系统输出。macOS 13+ 内部使用 ScreenCaptureKit；Windows 10+ 内部使用 WASAPI loopback。设置面板中选中"🔊 System Audio (native loopback)"按钮即可。macOS 首次使用时会弹出系统级"屏幕与系统录制"权限对话框,需要在 *系统设置 → 隐私与安全 → 屏幕与系统录制* 中授权后重启应用。
2. **麦克风 / 第三方 loopback 设备** — 通过浏览器 `getUserMedia` 选择任一音频输入,包括麦克风、Windows Stereo Mix、或 macOS 虚拟音频线缆。

| 平台 | 当前实际方案 | 状态 |
|------|------------|------|
| 所有平台 | `getUserMedia` 选择麦克风（默认） | ✅ 可用 |
| macOS 13+ | **整机系统音频 loopback**（Electron `getDisplayMedia` + `audio:'loopback'`,内部用 ScreenCaptureKit） | ✅ 可用,需授权系统录屏权限 |
| Windows 10+ | **整机系统音频 loopback**（Electron `getDisplayMedia` + `audio:'loopback'`,内部用 WASAPI loopback） | ✅ 可用 |
| macOS 12 及以下 | 系统音频选项不可用（系统不支持 ScreenCaptureKit） | 用虚拟音频线缆替代 |
| Windows 10+ 备用 | 在系统中启用 **Stereo Mix**（设置 → 系统 → 声音 → 录制设备） | ✅ 可用,需用户启用 |
| macOS 12 备用 | 安装非 GPL 虚拟音频线缆,把会议应用输出路由到该设备 | ✅ 可用,需用户配置 |
| macOS 13+ | **按应用 ScreenCaptureKit 捕获**（原生 N-API,只录 Zoom 等单个应用） | 🔜 计划中（PR #4b — `native/macos/` 有 Swift 草稿但 N-API 绑定为 placeholder） |

### 转写界面

录音过程中，**Transcript** 标签页会实时显示：

- **时间戳** — 每段文字对应的录音时间点（MM:SS 格式）
- **说话人** — 识别到的说话人名称（蓝色显示）
- **语言标记** — "EN"（英文）或 "中"（中文）
- **置信度** — "?" 标记表示识别置信度较低
- **文字内容** — 灰色表示正在识别中，确认后变为正常颜色

底部状态栏显示当前 STT 引擎名称和已转写的总段数。

### 停止录音

点击红色 **"停止 / Stop"** 按钮即可结束录音。转写结果自动保存到本地 SQLite 数据库。

---

## 实时翻译 / Real-time Translation

> **前提**：需要配置 AI API Key。

切换到 **Translation** 标签页：

- 每段转写文字的实时翻译
- 自动检测语言方向：
  - **EN → 中**（蓝色标记）
  - **中 → EN**（绿色标记）
- 原文（小字灰色）和译文（大字突出显示）并排展示
- "translating..." 表示正在翻译中
- 底部状态栏显示 "Live Translation / 实时翻译" 和翻译段数

---

## @检测与发言建议 / Mention Detection & Speech Suggestions

> **前提**：需要配置 AI API Key，且在引导流程中填写了个人信息。

### @检测机制

系统通过两层方式检测你被提及：

1. **关键词匹配**（快速）：匹配你的中英文姓名、别名、职位
2. **AI 语义分析**（智能）：理解隐含的提及，如"你觉得呢？""那边的同事说说？"

### 弹窗提醒

当检测到你被@时，屏幕顶部弹出红色提醒框：
- 显示谁在叫你以及他们说了什么
- 提取出的问题（如有）
- 两个按钮：**"忽略 / Dismiss"** 和 **"查看建议 / View Suggestions →"**

### 智能回复建议

在 **Speech** 标签页中，系统为每次@自动生成 **三种风格** 的回复建议：

| 风格 | 说明 | 颜色标记 |
|------|------|---------|
| **保守回应** (Conservative) | 谨慎、稳妥的回答 | 蓝色 |
| **积极建议** (Assertive) | 自信、直接的回答 | 绿色 |
| **提问引导** (Diplomatic) | 以提问方式引导讨论 | 紫色 |

每条建议附带 **置信度百分比**。鼠标悬停可看到 **"复制 / Copy"** 按钮，点击即可复制到剪贴板。

---

## 实时摘要 / Real-time Summary

> **前提**：需要配置 AI API Key。

### 录音中

切换到 **Summary** 标签页，系统会按设定的时间间隔（默认 5 分钟）自动生成摘要卡片：

| 类别 | 颜色标记 | 内容 |
|------|---------|------|
| **要点** (Key Points) | 蓝色左边框 | 本时段的关键讨论内容 |
| **决策** (Decisions) | 绿色左边框 | 达成的决策 |
| **待办事项** (Action Items) | 黄色左边框 | 含负责人和截止日期 |
| **待解决问题** (Open Questions) | 红色左边框 | 尚未解答的问题 |

每张摘要卡片显示对应的时间范围（如 "05:00 — 10:00"）。

### 录音结束后

录音停止后，系统自动生成 **完整的会议纪要预览**：

- **会议标题与执行摘要**（蓝色高亮框）
- **讨论主题** — 每个主题包含讨论内容、要点、决策
- **行动项清单** — 表格形式，包含负责人、任务、截止日期、优先级
- **未解决问题** — 项目符号列表
- **后续步骤** — 叙述性总结 + 下次会议建议
- **免责声明**："本纪要由 AI 辅助生成，内容仅供参考，请核实关键信息。"

---

## 会议纪要导出 / Meeting Minutes Export

录音结束后，在 Summary 标签页顶部可以看到导出按钮：

### Markdown 格式

点击 **"导出 MD / Export Markdown"**：
- 生成 `.md` 文件，包含完整的结构化会议纪要
- 文件名格式：`minutes_YYYY-MM-DD_会议标题.md`

### Word 格式

点击 **"导出 Word / Export Word"**：
- 生成 `.docx` 文件，包含标题、执行摘要、讨论议题、Action Items 表格、未解决问题、下一步建议和底部免责声明
- 文件名格式：`minutes_YYYY-MM-DD_会议标题.docx`
- 由 `docx` 库在 Electron 主进程生成，可用 Word/Pages/Google Docs 直接打开

**默认保存位置**：`~/MeetingAI/minutes/`

> 所有导出文档底部均附有声明："Generated by AI. Please verify key information. / AI 辅助生成，请核实关键信息。"

---

## 设置 / Settings

点击顶部 ⚙ 图标打开设置面板，包含 4 个标签页：

### AI 提供商

- 查看所有可用的 AI 提供商及状态标记（Default / Key ✓ / No Key）
- 点击"编辑 Key"输入或更新 API Key
- 点击"测试"验证连接
- 选择具体模型（每个提供商有 Fast / Balanced / Powerful 等多个可选模型）

**支持的 AI 提供商：**

| 提供商 | 获取 Key 地址 | 推荐场景 |
|--------|--------------|---------|
| DeepSeek | [platform.deepseek.com](https://platform.deepseek.com) | 性价比最高，国内外可用 |
| OpenAI | [platform.openai.com](https://platform.openai.com) | 海外首选 |
| Claude (Anthropic) | [console.anthropic.com](https://console.anthropic.com) | 高质量翻译和摘要 |
| Google Gemini | [aistudio.google.com](https://aistudio.google.com) | 最大上下文窗口 |
| 通义千问 | [dashscope.console.aliyun.com](https://dashscope.console.aliyun.com) | 国内首选 |
| MiniMax | [api.minimax.chat](https://api.minimax.chat) | 百万级 Token 上下文 |
| 智谱 GLM | [open.bigmodel.cn](https://open.bigmodel.cn) | 有免费额度 |

### 语音引擎 (STT)

- 切换语音转文字引擎
- 配置 STT API Key
- "本地 Whisper" 未来无需 Key，但当前版本被标记为 "Planned" 且不可选（whisper.cpp 集成尚未发布）

**支持的 STT 引擎：**

| 引擎 | 状态 | 获取 Key 地址 | 推荐场景 |
|------|------|--------------|---------|
| Deepgram | ✅ Stable | [console.deepgram.com](https://console.deepgram.com) | 海外首选，实时性好 |
| Whisper API | ✅ Stable | [platform.openai.com](https://platform.openai.com) | 海外备选 (5 秒分段,精度高) |
| 讯飞语音 | ✅ Stable | [console.xfyun.cn](https://console.xfyun.cn) | 国内首选（中文识别率最高，需 AppID:APIKey:APISecret 三段拼接） |
| 本地 Whisper | 🔜 Planned — 在设置面板中显示为禁用状态 | — | whisper.cpp 集成尚未发布 |

> 阿里语音 (Paraformer) 曾列在此处，但代码从未实现，已暂时从应用中移除。后续真正集成后会重新出现。

### 个人信息

- 修改中文姓名、英文姓名和职位
- 用于 @检测功能
- 所有信息仅存储在本地

### 应用偏好

| 设置项 | 选项 | 说明 |
|--------|------|------|
| **主题** | 浅色 / 深色 / 跟随系统 | 界面颜色主题 |
| **字体大小** | 小 / 中 / 大 | 影响全局文字大小 |
| **窗口透明度** | 50% — 100% 滑块 | 让窗口半透明以查看背后的会议画面 |
| **摘要间隔** | 3 / 5 / 10 / 15 分钟 | 多久生成一次实时摘要 |
| **网络区域** | 海外 / 中国 | 影响可选的 AI/STT 提供商 |

> **安全提示**：API Key 使用操作系统级加密（Electron safeStorage）存储在本地，绝不会传输到 MeetU 的服务器。

---

## 常见问题 / FAQ

### Q: 没有 AI API Key 可以使用吗？

可以。**录音 + 语音转文字**只需要一个 Deepgram API Key，无需 AI Key。但翻译、摘要、发言建议等 AI 功能需要额外配置 AI Key。

> 本地 Whisper 在路线图中尚未发布；当前实时转写可选 Deepgram（流式，延迟约 300ms）、OpenAI Whisper API（5 秒分段，精度高但延迟约 5-7 秒）或讯飞（PCM 流式，中文识别最佳）。

### Q: API 费用由谁承担？

所有 AI 和 STT 服务费用由你直接向对应服务商支付。MeetU 只是工具软件，不代理任何 AI 服务。大部分服务商都提供免费额度，日常会议使用费用很低。

### Q: 支持哪些会议软件？

MeetU 不与任何会议软件直接集成。它通过 `getUserMedia` 录制你在系统中选择的音频输入设备，因此适用于任何会议软件（Zoom、Teams、腾讯会议、Google Meet、飞书等）。**默认只录你的麦克风**；如需同时录到对方的声音，请在系统层启用 Stereo Mix（Windows）或虚拟音频线缆（macOS），并在应用内"音频输入设备"中选择该 loopback 设备。

### Q: 我的数据安全吗？

本地设备上：
- 录音文件（`.webm`）保存在本机指定文件夹
- 转写记录保存在本地 SQLite 数据库
- API Key 使用操作系统安全存储**加密保存**

外发流量（仅发往你自己配置的服务商）：
- 实时转写：音频从你的设备直接发送至你选择的 STT 服务商 —— 流式（Deepgram）或 5 秒分段（OpenAI Whisper API）
- AI 功能（翻译/摘要/@检测/发言建议）：相关转写文本发送至你选择的 AI 服务商

MeetU 本身：
- **没有任何 MeetU 服务器** — 不接收、不存储、不代理上述任何内容
- **零遥测、零分析、零追踪** — 不收集任何用户数据
- 所有网络流量只发生在你的设备与你选择的第三方服务商之间

### Q: 录音是否合法？

请务必遵守你所在地区关于录音的法律法规。许多地区要求 **获得所有参会者的同意** 才能录音。MeetU 在首次使用和每次录音前都会提醒你注意合规问题，但最终的法律责任由用户自行承担。

### Q: 如何获取 API Key？

请访问各服务商的官网注册并获取 API Key：
- **Claude (Anthropic)**: https://console.anthropic.com/
- **OpenAI**: https://platform.openai.com/
- **DeepSeek**: https://platform.deepseek.com/
- **Deepgram**: https://console.deepgram.com/

### Q: 窗口透明度有什么用？

你可以将 MeetU 窗口设为半透明（最低 50%），然后将它覆盖在会议窗口之上，这样可以同时看到会议画面和实时字幕/翻译。

### Q: 摘要间隔设多少合适？

- **3 分钟**：节奏快、内容密集的会议
- **5 分钟**（默认）：大多数常规会议
- **10-15 分钟**：较长的讨论或头脑风暴

### Q: Windows 上录音没有声音怎么办？

1. **检查麦克风权限**：系统设置 → 隐私 → 麦克风，确保 MeetU 已获得权限
2. **检查所选输入设备**：在 MeetU 设置 → 偏好设置 → 音频输入设备，确认选择的是当前在用的麦克风/loopback；点击"刷新设备"重新枚举
3. **如要录会议中其他参与者的声音**：在系统中启用 Stereo Mix（右键任务栏音量图标 → 声音 → 录制 → 显示已禁用的设备 → 启用 Stereo Mix），再在 MeetU 中选择该设备；如声卡不支持 Stereo Mix，可改用 VB-Cable 等非 GPL 的虚拟音频线缆
4. **确认没被独占**：另一个应用（会议软件等）有时会独占麦克风，关闭后再重启 MeetU
5. 上述都不行可重启 MeetU 看 dev console 的 `[Audio]` 日志定位具体错误

### Q: macOS 上无法捕获音频？

1. 前往 **系统设置 → 隐私与安全 → 麦克风**，确保 MeetU 已获得权限
2. 如果想录制对方的声音（不仅是自己的麦克风），需要安装一个非 GPL 的虚拟音频线缆（如商业替代品），把会议应用的输出路由到该设备，再在 MeetU 设置中选择该设备
3. 确保 macOS 版本为 13 Ventura 或更高
4. 路线图中：原生 ScreenCaptureKit 集成（届时无需虚拟线缆即可直接捕获指定应用音频，但当前版本尚未实现）

### Q: 可以同时使用多个 AI 提供商吗？

目前支持配置一个主 AI 提供商。你可以随时在设置中切换，无需重启应用。

---

## 快捷操作提示 / Tips

1. **半透明叠加** — 将窗口透明度调到 70%，覆盖在会议窗口上，边开会边看字幕
2. **离线模式** — 计划中（"本地 Whisper" 引擎尚未发布）；当前需要至少一个云端 STT Key 才能转写
3. **快速复制回复** — 在发言建议卡片上悬停鼠标，点击"复制"按钮即可复制建议内容
4. **切换 AI 服务商** — 在设置中随时更换 AI 提供商，无需重启应用
5. **深色模式** — 在弱光环境下切换为深色主题，保护眼睛

---

<p align="center">
  <sub>MeetU v1.1.0 — Built with care by the MeetU team</sub><br>
  <sub>Issues & Feedback: <a href="https://github.com/jessecu2024/MeetU/issues">github.com/jessecu2024/MeetU/issues</a></sub>
</p>
