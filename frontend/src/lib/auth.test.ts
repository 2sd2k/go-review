import { describe, expect, it } from 'vitest';
import { authConfigured, getAccessToken, supabase } from './auth';

describe('optional managed sign-in', () => {
  it('keeps local development usable without Supabase credentials', async () => {
    expect(Boolean(supabase)).toBe(authConfigured);
    if (!authConfigured) expect(await getAccessToken()).toBeNull();
  });
});
