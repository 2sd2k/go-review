import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { listReviews, saveReview, type SavedReview } from './reviewLibrary';
import { DEFAULT_ANALYSIS_SETTINGS } from '../types/analysis';
import { parseSgf, exportSgf } from './sgf';

describe('saved reviews', () => {
  it('persists original and edited trees separately and updates a saved game', async () => {
    const originalSgf = '(;GM[1]SZ[9];B[aa];W[bb])';
    const editedSgf = '(;GM[1]SZ[9];B[aa](;W[bb])(;W[cc]C[Try this]))';
    const review: SavedReview = {
      id: 'game-1', title: 'My game', savedAt: 1, originalSgf, editedSgf,
      settings: { ...DEFAULT_ANALYSIS_SETTINGS, boardSize: 9 }, results: [],
    };
    await saveReview(review);
    const [restored] = await listReviews();
    expect(restored).toEqual(review);
    expect(exportSgf(parseSgf(restored.editedSgf))).toContain('Try this');
    expect(restored.originalSgf).not.toContain('Try this');
    await saveReview({ ...review, savedAt: 2, title: 'Updated game' });
    expect(await listReviews()).toEqual([{ ...review, savedAt: 2, title: 'Updated game' }]);
  });
});
