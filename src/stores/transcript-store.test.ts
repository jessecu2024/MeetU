// Regression tests for demo-data isolation in the transcript store.
// Real-machine testing found 4 of 5 History rows were mock "Sarah /
// Michael" demo dialogue persisted as if real — addResult wrote every
// final line to SQLite regardless of the session's isMock flag. These
// tests pin the rule: mock sessions render in the UI but never write
// to the DB; real sessions persist exactly as before.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useTranscriptStore } from './transcript-store';
import type { TranscriptResult } from '../services/stt-engine/types';

const dbQuery = vi.fn(async (_sql: string, _params?: unknown[]) => []);

beforeEach(() => {
  dbQuery.mockClear();
  vi.stubGlobal('window', { electronAPI: { db: { query: dbQuery } } });
  useTranscriptStore.setState({
    entries: [], meetingId: null, isMockMode: false, activeEngineId: null,
  });
});

function finalResult(id: string, text: string): TranscriptResult {
  return { id, text, isFinal: true, startMs: 0, endMs: 1000, confidence: 0.9 };
}

describe('transcript persistence vs mock mode', () => {
  it('persists final lines for a REAL session', () => {
    useTranscriptStore.getState().startSession(7, 'deepgram', false);
    useTranscriptStore.getState().addResult(finalResult('r1', 'real words'));
    expect(dbQuery).toHaveBeenCalledTimes(1);
    expect(dbQuery.mock.calls[0][0]).toMatch(/INSERT INTO transcripts/);
    expect(dbQuery.mock.calls[0][1]).toContain('real words');
    // UI entry still added.
    expect(useTranscriptStore.getState().entries.map(e => e.text)).toEqual(['real words']);
  });

  it('does NOT persist final lines for a MOCK session (demo data must not pollute history)', () => {
    useTranscriptStore.getState().startSession(8, 'mock', true);
    useTranscriptStore.getState().addResult(finalResult('m1', 'simulated dialogue'));
    expect(dbQuery).not.toHaveBeenCalled();
    // But the demo line still renders in the UI.
    expect(useTranscriptStore.getState().entries.map(e => e.text)).toEqual(['simulated dialogue']);
  });

  it('does NOT persist the interim→final replacement path in mock mode either', () => {
    useTranscriptStore.getState().startSession(9, 'mock', true);
    const interim: TranscriptResult = { id: 'x', text: 'inter', isFinal: false, startMs: 0, endMs: 500, confidence: 0.5 };
    useTranscriptStore.getState().addResult(interim);
    useTranscriptStore.getState().addResult(finalResult('x', 'final text'));
    expect(dbQuery).not.toHaveBeenCalled();
    expect(useTranscriptStore.getState().entries.map(e => e.text)).toEqual(['final text']);
  });

  it('persists the interim→final replacement path for a real session', () => {
    useTranscriptStore.getState().startSession(10, 'deepgram', false);
    const interim: TranscriptResult = { id: 'y', text: 'inter', isFinal: false, startMs: 0, endMs: 500, confidence: 0.5 };
    useTranscriptStore.getState().addResult(interim);
    useTranscriptStore.getState().addResult(finalResult('y', 'final text'));
    expect(dbQuery).toHaveBeenCalledTimes(1);
    expect(dbQuery.mock.calls[0][1]).toContain('final text');
  });
});
