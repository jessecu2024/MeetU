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
    bodyEn: `• Your audio data and transcribed text are stored ONLY on your local device
• When you use AI features (translation, summary, etc.), related text is sent to third-party AI service providers that YOU choose and pay for (e.g., Anthropic, OpenAI, DeepSeek)
• This application does NOT store, transmit, or access any of your data
• Each AI service's data processing policy is the responsibility of the respective service provider — please review them independently`,
    bodyZh: `• 您的音频数据和文字内容仅存储在您的本地设备上
• 当您使用 AI 翻译/摘要等功能时，相关文本将发送至您自行选择和付费的第三方 AI 服务商（如 Anthropic、OpenAI、DeepSeek 等）
• 本应用不存储、不传输、不访问您的任何数据
• 各 AI 服务的数据处理政策由对应服务商负责，请您自行了解`,
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
