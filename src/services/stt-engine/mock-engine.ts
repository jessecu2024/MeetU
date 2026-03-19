// ============================================================
// Mock STT Engine — Simulated meeting conversation for dev/testing
// Returns bilingual mock transcripts with different speakers
// ============================================================

import type { STTEngine, STTEngineId, STTConfig, TranscriptResult } from './types';

const MOCK_LINES = [
  { speaker: 'Sarah', text: "Let's start with the Q1 review. Revenue was up 15% quarter over quarter.", lang: 'en' },
  { speaker: '张明', text: '好的，我来分享一下产品团队的进展。上个季度我们发布了三个主要功能。', lang: 'zh' },
  { speaker: 'Sarah', text: 'Great. How did the new onboarding flow perform? We had high expectations for that.', lang: 'en' },
  { speaker: '张明', text: '新用户引导流程的转化率提升了 22%，超出了我们的预期目标。', lang: 'zh' },
  { speaker: 'Michael', text: "That's impressive. What about user retention after the first week?", lang: 'en' },
  { speaker: '张明', text: '7日留存率从 35% 提升到 42%。主要是因为我们改进了新手任务系统。', lang: 'zh' },
  { speaker: 'Sarah', text: "Michael, can you share the marketing numbers? We need to discuss the budget for Q2.", lang: 'en' },
  { speaker: 'Michael', text: 'Sure. CAC dropped by 18% thanks to the organic content strategy. But paid channels need optimization.', lang: 'en' },
  { speaker: '李华', text: '我补充一下技术方面的数据。系统可用性达到了 99.97%，响应时间降低了 40ms。', lang: 'zh' },
  { speaker: 'Sarah', text: "Excellent. Let's move on to the Q2 planning. What are the top priorities?", lang: 'en' },
  { speaker: '张明', text: 'Q2 的重点是国际化和多语言支持。我们计划先支持日语和韩语。', lang: 'zh' },
  { speaker: 'Michael', text: 'We should also consider the partnership with the Japanese distributor. The timeline is tight.', lang: 'en' },
  { speaker: '李华', text: '技术上没有问题，我们已经完成了 i18n 框架的搭建。', lang: 'zh' },
  { speaker: 'Sarah', text: 'OK, so the action items are: finalize i18n by end of April, start Japanese beta in May. Any questions?', lang: 'en' },
  { speaker: '张明', text: '没有问题。我会在周五之前发出详细的项目计划。', lang: 'zh' },
];

let lineIndex = 0;
let transcriptId = 0;

export class MockSTTEngine implements STTEngine {
  readonly id: STTEngineId = 'local_whisper'; // Reuse local_whisper ID for mock
  readonly name = 'Mock STT (Development)';
  readonly region = 'local' as const;
  readonly supportsRealtime = true;

  private interval: ReturnType<typeof setInterval> | null = null;
  private callback: ((result: TranscriptResult) => void) | null = null;
  private running = false;
  private startTime = 0;

  setApiKey(): void { /* no-op */ }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    return { ok: true };
  }

  async startSession(_config: STTConfig): Promise<void> {
    this.running = true;
    this.startTime = Date.now();
    lineIndex = 0;

    // Emit mock transcripts every 2-4 seconds
    this.interval = setInterval(() => {
      if (!this.callback || !this.running) return;

      const line = MOCK_LINES[lineIndex % MOCK_LINES.length];
      const now = Date.now();

      // First emit interim result
      const interimId = `mock-${++transcriptId}`;
      this.callback({
        id: interimId,
        text: line.text.substring(0, Math.floor(line.text.length * 0.6)),
        isFinal: false,
        speaker: line.speaker,
        language: line.lang,
        startMs: now - this.startTime - 2000,
        endMs: now - this.startTime,
        confidence: 0.85,
      });

      // Then emit final result after a short delay
      setTimeout(() => {
        if (!this.callback || !this.running) return;
        this.callback({
          id: interimId,
          text: line.text,
          isFinal: true,
          speaker: line.speaker,
          language: line.lang,
          startMs: now - this.startTime - 2000,
          endMs: now - this.startTime,
          confidence: 0.95,
        });
      }, 800);

      lineIndex++;
    }, 2500 + Math.random() * 1500);
  }

  feedAudio(): void { /* mock ignores audio data */ }

  onTranscript(callback: (result: TranscriptResult) => void): void {
    this.callback = callback;
  }

  async stopSession(): Promise<void> {
    this.running = false;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  isRunning(): boolean {
    return this.running;
  }
}
