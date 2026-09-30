import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearActiveAnalysis, createAnalysisJobId, getActiveAnalysis, saveActiveAnalysis,
} from './analysisSession';

const values = new Map<string, string>();

beforeEach(() => {
  values.clear();
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('analysis session', () => {
  it('keeps the matching job across a reconnect and ignores stale clears', () => {
    const jobId = 'a'.repeat(32);
    saveActiveAnalysis({ cacheKey: 'game:visits', jobId });
    expect(getActiveAnalysis()).toEqual({ cacheKey: 'game:visits', jobId });
    clearActiveAnalysis('b'.repeat(32));
    expect(getActiveAnalysis()?.jobId).toBe(jobId);
    clearActiveAnalysis(jobId);
    expect(getActiveAnalysis()).toBeNull();
  });

  it('rejects malformed stored IDs and creates unpredictable-looking IDs', () => {
    values.set('go-review-active-analysis', JSON.stringify({ cacheKey: 'game', jobId: 'bad' }));
    expect(getActiveAnalysis()).toBeNull();
    const first = createAnalysisJobId();
    const second = createAnalysisJobId();
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(second).not.toBe(first);
  });
});
