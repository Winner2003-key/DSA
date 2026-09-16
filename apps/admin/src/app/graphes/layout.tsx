import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { SignOutButton } from '../../components/sign-out-button';
import { gateOutcome, resolveAccess, type Access } from '../../lib/access';
import { MOCK_MODE, SUPABASE_CONFIGURED } from '../../lib/env';
import { getServerClient } from '../../lib/supabase/server';

/**
 * The admin gate for every `/graphes/**` route. Signed-out visitors go to
 * `/connexion`; signed-in non-admins get told why they see nothing. Writes are
 * protected by RLS regardless of what this layout renders.
 */
export default async function GraphesLayout({ children }: { children: ReactNode }) {
  if (!MOCK_MODE && !SUPABASE_CONFIGURED) redirect('/connexion');

  const access: Access = MOCK_MODE ? { state: 'MOCK' } : await resolveAccess(await getServerClient());
  const outcome = gateOutcome(access);
  if (outcome.redirectTo) redirect(outcome.redirectTo);

  if (outcome.render === 'FORBIDDEN') {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-16">
        <h1 className="text-xl font-semibold tracking-tight">Accès réservé aux administrateurs</h1>
        <p className="mt-2 text-ink-soft">
          Le compte {access.state === 'FORBIDDEN' && access.email ? <strong className="font-medium text-ink">{access.email}</strong> : 'utilisé'} est
          bien connecté, mais il ne figure pas dans <code className="rounded-xs bg-surface-sunk px-1">admin_users</code>.
        </p>
        <p className="mt-2 text-ink-soft">
          Dans le tableau de bord Supabase, ouvrez <code className="rounded-xs bg-surface-sunk px-1">supabase/sql-editor/02_make_admin.sql</code>,
          remplacez l’adresse par la vôtre et lancez-le. Reconnectez-vous ensuite.
        </p>
        <p className="mt-5">
          <SignOutButton />
        </p>
      </main>
    );
  }

  const email = access.state === 'ADMIN' ? access.email : null;

  return (
    <div className="flex h-screen min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-4 border-b border-rule bg-surface px-4 py-2">
        <Link href="/graphes" className="flex items-baseline gap-2">
          <span className="text-[13px] font-semibold tracking-tight text-accent">DSA</span>
          <span className="text-ink-soft">Administration</span>
        </Link>
        <div className="ml-auto flex items-center gap-4">
          {MOCK_MODE ? (
            <span className="rounded-xs border border-review/40 bg-review-soft px-1.5 py-px text-[11px] font-medium text-review">
              Démonstration — données du fichier mini-graph.json
            </span>
          ) : (
            <>
              {email && <span className="text-ink-faint">{email}</span>}
              <SignOutButton />
            </>
          )}
        </div>
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
