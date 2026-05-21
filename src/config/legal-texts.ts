// ============================================================
// Bilingual Legal Texts / 双语法律文本
// English first, Chinese second — for global commercial use
// ============================================================

export const LEGAL_SECTIONS = [
  {
    titleEn: '1. Recording Compliance',
    titleZh: '1. 录音合规责任',
    bodyEn: `This application can capture system audio from your device and record it. Before using this feature, you are responsible for ensuring:
• You comply with all applicable laws and regulations regarding audio recording in your jurisdiction
• You have obtained informed consent from all meeting participants (where required by applicable law)
• You will not use recordings in any way that violates others' privacy rights

Recording laws vary significantly across jurisdictions. In some regions, all participants must consent to be legally recorded; in others, only one party's consent is required. Violating recording laws may constitute a criminal or civil offense. Please familiarize yourself with the specific regulations in your jurisdiction.`,
    bodyZh: `本应用可以捕获您设备上的系统音频并进行录制。在使用本功能前，您有责任确保：
• 已遵守您所在地区关于录音的法律法规
• 已获得所有会议参与者的知情同意（如适用法律要求）
• 不会将录音用于违反他人隐私权的目的

不同地区的录音法律差异很大。例如：部分地区要求所有参与者同意才能合法录音；部分地区只需录音者一方同意。违反录音法律可能构成违法行为，请务必了解您所在地区的具体规定。`,
    isWarning: true,
  },
  {
    titleEn: '2. Data Processing',
    titleZh: '2. 数据处理说明',
    bodyEn: `Persistent storage on your device:
• Raw recordings (.webm files) are saved to a folder under your home directory
• Meeting transcripts are stored in a local SQLite database
• Application settings and your encrypted API Keys are persisted via your OS's secure storage

Outbound transmission (only to providers YOU configure and pay for):
• Live transcription: audio frames are streamed directly from your device to your chosen STT provider (currently only Deepgram is selectable; Whisper API, iFlytek, and Local Whisper are roadmap items)
• AI features (translation, summary, mention detection, speech suggestions): the relevant transcript text is sent to your chosen AI provider (e.g., Anthropic, OpenAI, Google, DeepSeek)

What MeetU does NOT do:
• MeetU operates no servers and does not receive, store, or proxy your audio, transcripts, or API Keys. All network traffic goes directly between your device and the providers you select.
• Each STT/AI provider's data-handling policy is the responsibility of that provider — please review them independently before configuring a key.`,
    bodyZh: `保存在您本地设备上：
• 原始录音文件（.webm）存放于您主目录下的指定文件夹
• 会议转写文本存放于本地 SQLite 数据库
• 应用设置和加密后的 API Key 通过操作系统安全存储进行持久化

向外发送（仅发往您自己配置并付费的服务商）：
• 实时转写：音频帧从您的设备直接流式发送至您选择的 STT 服务商（当前仅 Deepgram 可选；Whisper API、讯飞、Local Whisper 均在路线图中）
• AI 功能（翻译/摘要/@检测/发言建议）：相关转写文本将发送至您选择的 AI 服务商（如 Anthropic、OpenAI、Google、DeepSeek 等）

MeetU 本身不会做的事：
• MeetU 不运行任何服务器，不接收、不存储、不代理您的音频、转写或 API Key。所有网络流量直接发生在您的设备与您选择的服务商之间。
• 各 STT/AI 服务商的数据处理政策由其各自负责，配置 API Key 前请自行了解。`,
  },
  {
    titleEn: '3. API Key Security',
    titleZh: '3. API Key 安全',
    bodyEn: `• Your API Keys are stored encrypted on your local device only
• This application will NEVER send your API Keys to our servers
• AI requests are sent directly from your device to the AI service provider you selected
• API usage fees are settled directly between you and the respective AI service provider`,
    bodyZh: `• 您的 API Key 通过加密方式存储在您的本地设备上
• 本应用不会将您的 API Key 发送至我们的服务器
• AI 请求直接从您的设备发往您选择的 AI 服务商
• API 使用费用由您与对应 AI 服务商之间直接结算`,
  },
  {
    titleEn: '4. Disclaimer',
    titleZh: '4. 免责声明',
    bodyEn: `This software is a PERSONAL NOTE-TAKING TOOL. All legal consequences arising from your use of this software for recording, transcription, translation, or any other purpose are your sole responsibility. The software provider assumes no legal liability for how users choose to use this software. AI-generated translations, summaries, and speech suggestions are for reference only and do not constitute professional advice.`,
    bodyZh: `本软件是一个个人笔记辅助工具。使用本软件录音、转写、翻译所产生的一切法律后果由用户自行承担。软件提供方不对用户的使用方式承担任何法律责任。AI 生成的翻译、摘要和发言建议仅供参考，不构成专业意见。`,
  },
];

export const CONSENT_CHECKBOX_EN =
  'I have read and understood the terms above. I confirm that I will comply with recording laws in my jurisdiction and understand that AI features require my own API Key.';
export const CONSENT_CHECKBOX_ZH =
  '我已阅读并理解以上条款，确认自行承担录音合规责任，并了解 AI 功能需使用我自己的 API Key。';

export const RECORDING_CONSENT_EN = {
  title: 'Ready to Record',
  body: 'Please ensure you have obtained consent from all meeting participants. Recording without consent may be illegal in your jurisdiction.',
  dontShowAgain: "Don't remind again this session",
  cancel: 'Cancel',
  confirm: 'Confirmed, Start Recording',
};

export const RECORDING_CONSENT_ZH = {
  title: '准备开始录音',
  body: '请确保您已获得所有会议参与者的同意。根据您所在地区的法律，未经同意录音可能违法。',
  dontShowAgain: '本次会话不再提醒',
  cancel: '取消',
  confirm: '已确认，开始录音',
};

export const EXPORT_DISCLAIMER_EN =
  'This meeting summary was generated with AI assistance. The content is for reference only — please verify key information.';
export const EXPORT_DISCLAIMER_ZH =
  '本会议纪要由 AI 辅助生成，内容仅供参考，请核实关键信息。';
