import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { authConfigIncomplete, supabase } from '../../lib/auth';

export default function AuthPanel({ onSignOut }: { onSignOut: () => Promise<void> }) {
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    let mounted = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (mounted) setUser(data.session?.user ?? null);
    }).catch(() => {
      if (mounted) setMessage('Could not load your sign-in session.');
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);

  if (authConfigIncomplete) {
    return <p className="text-xs text-red-400">Supabase sign-in needs both frontend environment settings.</p>;
  }
  if (!supabase) return null;

  const sendLink = async () => {
    if (!supabase || !email.trim()) return;
    setBusy(true);
    setMessage('');
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: window.location.origin },
      });
      setMessage(error ? error.message : 'Check your email for a sign-in link.');
    } catch {
      setMessage('Could not send the sign-in link. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    if (!supabase) return;
    setBusy(true);
    try {
      await onSignOut();
      const { error } = await supabase.auth.signOut();
      if (error) setMessage(error.message);
    } catch {
      setMessage('Could not sign out. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return <section className="rounded border border-gray-700 bg-gray-800/50 p-2 text-xs" aria-label="Account">
    {user ? <div className="flex items-center justify-between gap-2">
      <span className="min-w-0 truncate" title={user.email}>Signed in as {user.email}</span>
      <button type="button" disabled={busy} onClick={() => void signOut()}
        className="rounded bg-gray-700 px-2 py-1 disabled:opacity-50">Sign out</button>
    </div> : <form onSubmit={event => { event.preventDefault(); void sendLink(); }}>
      <label htmlFor="sign-in-email" className="mb-1 block">Sign in to analyze and ask the coach</label>
      <div className="flex gap-1">
        <input id="sign-in-email" type="email" required autoComplete="email" value={email}
          onChange={event => setEmail(event.target.value)} placeholder="Email address"
          className="min-w-0 flex-1 rounded border border-gray-600 bg-gray-900 px-2 py-1" />
        <button type="submit" disabled={busy}
          className="rounded bg-gray-700 px-2 py-1 disabled:opacity-50">Email link</button>
      </div>
    </form>}
    {message && <p role="status" className="mt-1 text-gray-300">{message}</p>}
  </section>;
}
