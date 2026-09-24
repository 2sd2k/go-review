import { useEffect, useState } from 'react';
import { exportSgf, parseSgf } from '../../lib/sgf';
import { hashText } from '../../lib/analysisCache';
import {
  deleteReview, listReviews, renameReview, resolveSelectedPath, saveReview,
  selectedPath, updateReview, type SavedReview,
} from '../../lib/reviewLibrary';
import { useGameStore } from '../../stores/gameStore';
import { useAnalysisStore } from '../../stores/analysisStore';
import type { AnalysisSettings } from '../../types/analysis';

export default function ReviewLibrary({ settings, onRestore }: {
  settings: AnalysisSettings;
  onRestore: (settings: AnalysisSettings) => void;
}) {
  const game = useGameStore(state => state.game);
  const currentNodeId = useGameStore(state => state.currentNodeId);
  const results = useAnalysisStore(state => state.results);
  const analyzing = useAnalysisStore(state => state.isAnalyzing);
  const [reviews, setReviews] = useState<SavedReview[]>([]);
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = async () => setReviews(await listReviews());

  useEffect(() => {
    let active = true;
    void listReviews().then(items => { if (active) setReviews(items); })
      .catch(error => { if (active) setMessage(String(error.message)); });
    return () => { active = false; };
  }, []);

  // After the first explicit save, persist edits, position, settings, and results.
  useEffect(() => {
    if (!game?.localReviewId || analyzing) return;
    const id = game.localReviewId;
    const timer = window.setTimeout(() => {
      const snapshot = {
        editedSgf: exportSgf(game),
        settings,
        results: Array.from(results.entries()),
        selectedPath: selectedPath(game, currentNodeId),
      };
      void updateReview(id, snapshot).then(existing => {
        if (existing) void listReviews().then(setReviews);
      }).catch(error => setMessage(error instanceof Error ? error.message : 'Autosave failed.'));
    }, 600);
    return () => window.clearTimeout(timer);
  }, [game, currentNodeId, results, settings, analyzing]);

  const save = async () => {
    if (!game || busy || analyzing) return;
    setBusy(true);
    try {
      const editedSgf = exportSgf(game);
      const originalSgf = game.originalSgf ?? editedSgf;
      const id = game.localReviewId ?? (game.originalSgf
        ? await hashText(originalSgf)
        : crypto.randomUUID());
      const previous = reviews.find(review => review.id === id);
      await saveReview({
        id, originalSgf, editedSgf, settings, savedAt: Date.now(),
        title: previous?.title ?? `${game.metadata.blackPlayer || 'Black'} vs ${game.metadata.whitePlayer || 'White'} · ${game.size}×${game.size}`,
        results: Array.from(results.entries()),
        selectedPath: selectedPath(game, currentNodeId),
      });
      if (useGameStore.getState().game === game) {
        useGameStore.setState({ game: { ...game, originalSgf, localReviewId: id } });
      }
      await refresh();
      setMessage('Saved. Further changes will save automatically.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save review.'); }
    finally { setBusy(false); }
  };

  const restore = (review: SavedReview) => {
    try {
      const restored = parseSgf(review.editedSgf);
      restored.originalSgf = review.originalSgf;
      restored.localReviewId = review.id;
      onRestore(review.settings);
      useGameStore.getState().loadGame(restored);
      useGameStore.getState().goToNode(resolveSelectedPath(restored, review.selectedPath));
      const analysis = useAnalysisStore.getState();
      analysis.clear();
      analysis.setResults(new Map(review.results));
      const last = Math.max(0, ...review.results.map(([move]) => move));
      analysis.setProgress(last, last);
      setMessage('Saved review opened.');
    } catch { setMessage('This saved game could not be opened.'); }
  };

  const rename = async (review: SavedReview) => {
    try {
      await renameReview(review.id, newTitle);
      await refresh();
      setEditingId(null);
      setMessage('Review renamed.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not rename review.'); }
  };

  const remove = async (review: SavedReview) => {
    if (!window.confirm(`Delete “${review.title}” from this browser? This cannot be undone.`)) return;
    try {
      await deleteReview(review.id);
      const active = useGameStore.getState().game;
      if (active?.localReviewId === review.id) {
        useGameStore.setState({ game: { ...active, localReviewId: undefined } });
      }
      await refresh();
      setMessage('Saved review deleted. The open board remains available.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not delete review.'); }
  };

  const filtered = reviews.filter(review => review.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));

  return (
    <section className="bg-gray-800/50 rounded-lg p-3 border border-gray-700">
      <h2 className="text-sm font-semibold mb-2">Saved reviews</h2>
      <button type="button" disabled={!game || busy || analyzing} onClick={() => void save()}
        className="w-full rounded bg-gray-700 px-2 py-2 text-xs disabled:opacity-50">
        {busy ? 'Saving…' : 'Save current review'}
      </button>
      <p className="text-xs text-gray-500 my-2">Save once; later moves and completed analysis save automatically on this device.</p>
      <label htmlFor="review-search" className="sr-only">Search saved reviews</label>
      <input id="review-search" type="search" value={query} onChange={event => setQuery(event.target.value)}
        placeholder="Search reviews" className="w-full rounded border border-gray-600 bg-gray-900 px-2 py-1.5 text-xs mb-2" />
      <ul className="max-h-52 overflow-auto space-y-1">
        {filtered.map(review => <li key={review.id} className="rounded border border-gray-600 p-1">
          {editingId === review.id ? (
            <form onSubmit={event => { event.preventDefault(); void rename(review); }} className="flex gap-1">
              <label className="sr-only" htmlFor={`rename-${review.id}`}>Review name</label>
              <input id={`rename-${review.id}`} value={newTitle} maxLength={100}
                onChange={event => setNewTitle(event.target.value)}
                className="min-w-0 flex-1 rounded border border-gray-600 bg-gray-900 px-1 text-xs" />
              <button type="submit" className="text-xs px-1">Save</button>
              <button type="button" onClick={() => setEditingId(null)} className="text-xs px-1">Cancel</button>
            </form>
          ) : (
            <>
              <button type="button" disabled={busy || analyzing} onClick={() => restore(review)}
                className="text-left w-full rounded bg-gray-700 p-2 text-xs disabled:opacity-50">
                {review.title}<br />
                <span>{new Date(review.savedAt).toLocaleString()} · {review.results.length} analyzed positions</span>
              </button>
              <div className="flex gap-2 justify-end text-xs mt-1">
                <button type="button" onClick={() => { setEditingId(review.id); setNewTitle(review.title); }} aria-label={`Rename ${review.title}`}>Rename</button>
                <button type="button" onClick={() => void remove(review)} aria-label={`Delete ${review.title}`}>Delete</button>
              </div>
            </>
          )}
        </li>)}
      </ul>
      <p role="status" className="text-xs mt-2">{message}</p>
    </section>
  );
}
