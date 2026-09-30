import { createClient } from '@supabase/supabase-js';

const projectUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

function validProjectUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

export const authConfigured = validProjectUrl(projectUrl) && Boolean(publishableKey);
export const authConfigIncomplete = Boolean(projectUrl || publishableKey) && !authConfigured;
export const supabase = authConfigured
  ? createClient(projectUrl!, publishableKey!, { auth: { autoRefreshToken: true, persistSession: true } })
  : null;

export async function getAccessToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session?.access_token ?? null;
}
