const OGS_HOSTS = new Set(['online-go.com', 'www.online-go.com']);

export function extractOgsGameId(input: string): number | null {
  const value = input.trim();
  const validId = (id: string): number | null => {
    const number = Number(id);
    return /^\d+$/.test(id) && Number.isSafeInteger(number) && number > 0 ? number : null;
  };
  if (/^\d+$/.test(value)) return validId(value);

  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    if (!OGS_HOSTS.has(url.hostname.toLowerCase()) || url.username || url.password || url.port) return null;

    const match = url.pathname.match(/^\/game\/(?:view\/)?(\d+)\/?$/);
    return match ? validId(match[1]) : null;
  } catch {
    return null;
  }
}

export function getOgsSgfUrl(gameId: number): string {
  return `https://online-go.com/api/v1/games/${gameId}/sgf`;
}

export async function fetchOgsSgf(input: string): Promise<string> {
  const gameId = extractOgsGameId(input);
  if (!gameId) {
    throw new Error('Enter an OGS game ID or a public online-go.com game URL.');
  }

  const base = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:8000' : window.location.origin);
  const response = await fetch(new URL(`/api/ogs/${gameId}/sgf`, base), {
    signal: AbortSignal.timeout(20000),
    headers: { Accept: 'application/x-go-sgf, text/plain' },
  });
  if (!response.ok) {
    if (response.status === 429) throw new Error('OGS is rate limiting imports. Please try again later.');
    if (response.status === 404 || response.status === 403) {
      throw new Error('That OGS game was not found or is not publicly accessible.');
    }
    throw new Error(`OGS could not provide this game (HTTP ${response.status}).`);
  }

  const sgf = await response.text();
  if (!sgf.trim().startsWith('(')) {
    throw new Error('OGS returned an invalid or empty SGF record.');
  }
  return sgf;
}
