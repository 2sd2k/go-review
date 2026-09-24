import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  deleteReview, listReviews, renameReview, resolveSelectedPath,
  saveReview, selectedPath, updateReview, type SavedReview,
} from './reviewLibrary';
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

  it('restores a selected variation across SGF serialization', () => {
    const original = parseSgf('(;GM[1]SZ[9];B[aa](;W[bb])(;W[cc];B[dd]))');
    const selected = Object.values(original.nodes).find(node => node.move?.color === 'B' &&
      Array.isArray(node.move.point) && node.move.point[0] === 3 && node.move.point[1] === 3);
    expect(selected).toBeDefined();
    const path = selectedPath(original, selected!.id);
    const restored = parseSgf(exportSgf(original));
    const node = restored.nodes[resolveSelectedPath(restored, path)];
    expect(node.move).toEqual(selected!.move);
  });

  it('keeps a renamed title during autosave and does not recreate deleted reviews', async () => {
    const review: SavedReview = {
      id: 'game-2', title: 'Original', savedAt: 10,
      originalSgf: '(;GM[1]SZ[9])', editedSgf: '(;GM[1]SZ[9])',
      settings: { ...DEFAULT_ANALYSIS_SETTINGS, boardSize: 9 }, results: [],
    };
    await saveReview(review);
    await renameReview(review.id, 'Studied game');
    await updateReview(review.id, { editedSgf: '(;GM[1]SZ[9];B[aa])',
      results: [], settings: review.settings, selectedPath: [0] });
    expect((await listReviews()).find(item => item.id === review.id)).toMatchObject({
      title: 'Studied game', selectedPath: [0], editedSgf: '(;GM[1]SZ[9];B[aa])',
    });
    await deleteReview(review.id);
    await updateReview(review.id, { editedSgf: review.editedSgf,
      results: [], settings: review.settings, selectedPath: [] });
    expect((await listReviews()).some(item => item.id === review.id)).toBe(false);
  });
});
