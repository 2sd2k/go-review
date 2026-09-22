import { useEffect, useState } from 'react';
import { exportSgf, parseSgf } from '../../lib/sgf';
import { hashText } from '../../lib/analysisCache';
import { listReviews, saveReview, type SavedReview } from '../../lib/reviewLibrary';
import { useGameStore } from '../../stores/gameStore';
import { useAnalysisStore } from '../../stores/analysisStore';
import type { AnalysisSettings } from '../../types/analysis';

export default function ReviewLibrary({ settings, onRestore }: {
  settings: AnalysisSettings;
  onRestore: (settings: AnalysisSettings) => void;
}) {
  const game = useGameStore(state => state.game);
  const analyzing = useAnalysisStore(state => state.isAnalyzing);
  const [reviews, setReviews] = useState<SavedReview[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void listReviews().then(items => { if (active) setReviews(items); })
      .catch(error => { if (active) setMessage(String(error.message)); });
    return () => { active = false; };
  }, []);

  const save = async () => {
    if (!game || busy || analyzing) return;
    setBusy(true);
    try {
      const editedSgf = exportSgf(game);
      const originalSgf = game.originalSgf ?? editedSgf;
      const results = Array.from(useAnalysisStore.getState().results.entries());
      const id = await hashText(originalSgf);
      await saveReview({
        id, originalSgf, editedSgf, settings, savedAt: Date.now(),
        title: `${game.metadata.blackPlayer || 'Black'} vs ${game.metadata.whitePlayer || 'White'} · ${game.size}×${game.size}`,
        results,
      });
      setReviews(await listReviews());
      setMessage('Review saved in this browser.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save review.'); }
    finally { setBusy(false); }
  };

  const restore = (review: SavedReview) => {
    try {
      const restored = parseSgf(review.editedSgf);
      restored.originalSgf = review.originalSgf;
      onRestore(review.settings);
      useGameStore.getState().loadGame(restored);
      const analysis = useAnalysisStore.getState();
      analysis.clear();
      analysis.setResults(new Map(review.results));
      const last = Math.max(0, ...review.results.map(([move]) => move));
      analysis.setProgress(last, last);
      setMessage('Saved review opened.');
    } catch { setMessage('This saved game could not be opened.'); }
  };

  return (
    <section className="bg-gray-800/50 rounded-lg p-3 border border-gray-700">
      <h2 className="text-sm font-semibold mb-2">Saved reviews</h2>
      <button type="button" disabled={!game || busy || analyzing} onClick={() => void save()}
        className="w-full rounded bg-gray-700 px-2 py-2 text-xs disabled:opacity-50">
        {busy ? 'Saving…' : 'Save current review'}
      </button>
      <p className="text-xs text-gray-500 my-2">Stored on this device. Saving again updates the same imported game, including variations.</p>
      <ul className="max-h-48 overflow-auto space-y-1">
        {reviews.map(review => <li key={review.id}>
          <button type="button" disabled={busy || analyzing} onClick={() => restore(review)}
            className="text-left w-full rounded bg-gray-700 p-2 text-xs disabled:opacity-50">
            {review.title}<br />
            <span>{new Date(review.savedAt).toLocaleString()} · {review.results.length} analyzed positions</span>
          </button>
        </li>)}
      </ul>
      <p role="status" className="text-xs mt-2">{message}</p>
    </section>
  );
}
