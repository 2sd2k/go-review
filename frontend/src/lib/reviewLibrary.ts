import type { AnalysisSettings, MoveAnalysis } from '../types/analysis';

export interface SavedReview {
  id: string;
  title: string;
  savedAt: number;
  originalSgf: string;
  editedSgf: string;
  settings: AnalysisSettings;
  results: Array<[number, MoveAnalysis]>;
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
