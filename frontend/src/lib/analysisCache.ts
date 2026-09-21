import type { MoveAnalysis } from '../types/analysis';
import type { AnalysisSettings } from '../types/analysis';

const DB_NAME = 'go-review-cache';
const DB_VERSION = 1;
const STORE_NAME = 'analysis';
export const KATAGO_MODEL_VERSION = import.meta.env.VITE_KATAGO_MODEL_VERSION ?? 'unknown';

export interface AnalysisCacheEntry {
  key: string;
  sgfHash: string;
  modelVersion: string;
  rules: AnalysisSettings['rules'];
  komi: number;
  maxVisits: number;
  boardSize: number;
  totalMoves: number;
  results: Array<[number, MoveAnalysis]>;
  createdAt: number;
}

export interface AnalysisCacheIdentity {
  sgfHash: string;
  modelVersion: string;
  rules: AnalysisSettings['rules'];
  komi: number;
  maxVisits: number;
  boardSize: number;
}

export function makeAnalysisCacheKey(identity: AnalysisCacheIdentity): string {
  return [
    identity.sgfHash,
    identity.modelVersion,
    identity.rules,
    identity.komi.toString(),
    identity.maxVisits.toString(),
    identity.boardSize.toString(),
  ].join(':');
}

export async function hashText(value: string): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const bytes = new TextEncoder().encode(value);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  // This fallback keeps cache keys deterministic in older browsers and test runners.
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);

  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

export async function getCachedAnalysis(key: string): Promise<AnalysisCacheEntry | null> {
  const database = await openDatabase();
  if (!database) return null;

  return new Promise((resolve) => {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve((request.result as AnalysisCacheEntry | undefined) ?? null);
    request.onerror = () => resolve(null);
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => resolve(null);
  });
}

export async function saveCachedAnalysis(entry: AnalysisCacheEntry): Promise<boolean> {
  const database = await openDatabase();
  if (!database) return false;

  return new Promise((resolve) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(entry);
    transaction.oncomplete = () => {
      database.close();
      resolve(true);
    };
    transaction.onerror = () => {
      database.close();
      resolve(false);
    };
    transaction.onabort = () => {
      database.close();
      resolve(false);
    };
  });
}
