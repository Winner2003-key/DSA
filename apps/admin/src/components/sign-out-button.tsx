'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { getBrowserClient } from '../lib/supabase/client';

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="text-ink-soft underline-offset-2 hover:text-ink hover:underline"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await getBrowserClient().auth.signOut();
        router.replace('/connexion');
        router.refresh();
      }}
    >
      Se déconnecter
    </button>
  );
}
