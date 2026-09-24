import type { AnalysisSettings, MoveAnalysis } from '../types/analysis';
import type { Game } from '../types/game';
import { childIds } from './moveTree';

export interface SavedReview {
  id: string;
  title: string;
  savedAt: number;
  originalSgf: string;
  editedSgf: string;
  settings: AnalysisSettings;
  results: Array<[number, MoveAnalysis]>;
  selectedPath?: number[];
}

/** Child indexes survive SGF export and re-import even when numeric node IDs change. */
export function selectedPath(game: Game, nodeId: number): number[] {
  const indexes: number[] = [];
  let current = game.nodes[nodeId];
  while (current && current.parentId != null) {
    const parent = game.nodes[current.parentId];
    if (!parent) break;
    const index = childIds(parent).indexOf(current.id);
    if (index < 0) break;
    indexes.unshift(index);
    current = parent;
  }
  return indexes;
}

export function resolveSelectedPath(game: Game, path: number[] = []): number {
  let nodeId = game.rootId;
  for (const index of path) {
    if (!Number.isInteger(index) || index < 0) break;
    const next = childIds(game.nodes[nodeId])[index];
    if (next == null) break;
    nodeId = next;
  }
  return nodeId;
}

export async function reviewLibrary<T>(
  action: (store: IDBObjectStore) => IDBRequest<T>,
  mode: IDBTransactionMode = 'readonly',
): Promise<T> {
  if (typeof indexedDB === 'undefined') throw new Error('This browser cannot save reviews locally. Download the SGF to keep your game.');
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('go-review-library', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('reviews', { keyPath: 'id' });
    open.onerror = () => reject(new Error('Could not open saved reviews.'));
    open.onblocked = () => reject(new Error('Close other Go Review tabs and try again.'));
    open.onsuccess = () => {
      const db = open.result;
      db.onversionchange = () => db.close();
      try {
        const tx = db.transaction('reviews', mode);
        const request = action(tx.objectStore('reviews'));
        tx.oncomplete = () => { db.close(); resolve(request.result); };
        tx.onabort = tx.onerror = () => { db.close(); reject(new Error('Could not save or read reviews. Browser storage may be full or disabled.')); };
      } catch (error) { db.close(); reject(error); }
    };
  });
}

export async function listReviews(): Promise<SavedReview[]> {
  const reviews = await reviewLibrary<SavedReview[]>(store => store.getAll());
  return reviews.sort((a, b) => b.savedAt - a.savedAt);
}

export function saveReview(review: SavedReview): Promise<IDBValidKey> {
  return reviewLibrary(store => store.put(review), 'readwrite');
}

export function getReview(id: string): Promise<SavedReview | undefined> {
  return reviewLibrary(store => store.get(id));
}

export function deleteReview(id: string): Promise<undefined> {
  return reviewLibrary(store => store.delete(id), 'readwrite');
}

/** Keep the existing title and original source while replacing the live snapshot. */
export function updateReview(id: string, snapshot: Pick<SavedReview,
  'editedSgf' | 'settings' | 'results' | 'selectedPath'>): Promise<SavedReview | undefined> {
  return reviewLibrary(store => {
    const request = store.get(id) as IDBRequest<SavedReview | undefined>;
    request.onsuccess = () => {
      if (request.result) store.put({ ...request.result, ...snapshot, savedAt: Date.now() });
    };
    return request;
  }, 'readwrite');
}

export function renameReview(id: string, title: string): Promise<SavedReview | undefined> {
  const trimmed = title.trim();
  if (!trimmed) return Promise.reject(new Error('Enter a name for this review.'));
  return reviewLibrary(store => {
    const request = store.get(id) as IDBRequest<SavedReview | undefined>;
    request.onsuccess = () => {
      if (request.result) store.put({ ...request.result, title: trimmed });
    };
    return request;
  }, 'readwrite');
}
