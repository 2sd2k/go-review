import { describe, expect, it } from 'vitest';
import { hashText, makeAnalysisCacheKey } from './analysisCache';

describe('analysis cache identity', () => {
  it('creates stable keys from every analysis setting', () => {
    const identity = {
      sgfHash: 'abc123',
      modelVersion: 'katago-v1',
      rules: 'chinese' as const,
      komi: 7.5,
      maxVisits: 500,
      boardSize: 19,
    };

    expect(makeAnalysisCacheKey(identity)).toBe('abc123:katago-v1:chinese:7.5:500:19');
    expect(makeAnalysisCacheKey({ ...identity, maxVisits: 100 })).not.toBe(makeAnalysisCacheKey(identity));
  });

  it('hashes identical SGF text deterministically', async () => {
    const first = await hashText('(;GM[1]SZ[19])');
    const second = await hashText('(;GM[1]SZ[19])');

    expect(first).toBe(second);
    expect(first.length).toBeGreaterThan(0);
  });
});
