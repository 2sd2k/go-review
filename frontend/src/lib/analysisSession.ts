const STORAGE_KEY = 'go-review-active-analysis';

interface ActiveAnalysis {
  cacheKey: string;
  jobId: string;
}

function isJobId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{32}$/.test(value);
}

export function createAnalysisJobId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function getActiveAnalysis(): ActiveAnalysis | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const { cacheKey, jobId } = value as Record<string, unknown>;
    return typeof cacheKey === 'string' && isJobId(jobId) ? { cacheKey, jobId } : null;
  } catch {
    return null;
  }
}

export function saveActiveAnalysis(analysis: ActiveAnalysis): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(analysis));
  } catch {
    // Analysis still works when browser session storage is unavailable.
  }
}

export function clearActiveAnalysis(jobId: string): void {
  try {
    if (getActiveAnalysis()?.jobId === jobId) sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore blocked browser storage.
  }
}
