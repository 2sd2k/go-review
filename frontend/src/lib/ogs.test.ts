import { describe, expect, it } from 'vitest';
import { extractOgsGameId, getOgsSgfUrl } from './ogs';

describe('OGS game references', () => {
  it('accepts a numeric game ID', () => {
    expect(extractOgsGameId('123456')).toBe(123456);
  });

  it('extracts IDs from public game URLs', () => {
    expect(extractOgsGameId('https://online-go.com/game/123456')).toBe(123456);
    expect(extractOgsGameId('www.online-go.com/game/view/987')).toBe(987);
  });

  it('rejects unrelated or malformed URLs', () => {
    for (const value of ['0', '9007199254740992', 'https://online-go.com/game/abc/123',
      'https://online-go.com/game/123/extra', 'https://user@online-go.com/game/123']) {
      expect(extractOgsGameId(value)).toBeNull();
    }
    expect(extractOgsGameId('https://example.com/game/123')).toBeNull();
    expect(extractOgsGameId('https://online-go.com/player/123')).toBeNull();
    expect(extractOgsGameId('not a game')).toBeNull();
  });

  it('builds the public SGF endpoint', () => {
    expect(getOgsSgfUrl(42)).toBe('https://online-go.com/api/v1/games/42/sgf');
  });
});
