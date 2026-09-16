'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { getBrowserClient } from '../lib/supabase/client';

/**
 * Supabase email + password sign-in. Being signed in is not access: the graph
 * routes then ask the database `dsa_is_admin()`.
 */
export function SignInForm({ next }: { next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { error: signInError } = await getBrowserClient().auth.signInWithPassword({ email, password });
    if (signInError) {
      setError(
        signInError.message === 'Invalid login credentials'
          ? 'Adresse e-mail ou mot de passe incorrect.'
          : `Connexion impossible : ${signInError.message}`,
      );
      setBusy(false);
      return;
    }
    router.replace(next);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div>
        <label className="field-label" htmlFor="email">
          Adresse e-mail
        </label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          required
          className="field"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      <div>
        <label className="field-label" htmlFor="password">
          Mot de passe
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          className="field"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>
      {error && <p className="rounded-sm border border-rejected/40 bg-rejected-soft px-3 py-2 text-rejected">{error}</p>}
      <button type="submit" className="btn btn-primary w-full" disabled={busy}>
        {busy ? 'Connexion…' : 'Se connecter'}
      </button>
    </form>
  );
}
