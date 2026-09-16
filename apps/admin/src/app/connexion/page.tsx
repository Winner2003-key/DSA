import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SignInForm } from '../../components/sign-in-form';
import { MOCK_MODE, SUPABASE_CONFIGURED } from '../../lib/env';
import { getServerClient } from '../../lib/supabase/server';

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ suite?: string }> }) {
  const { suite } = await searchParams;
  const next = suite && suite.startsWith('/') ? suite : '/graphes';

  if (MOCK_MODE) redirect(next);

  if (SUPABASE_CONFIGURED) {
    const {
      data: { user },
    } = await (await getServerClient()).auth.getUser();
    if (user) redirect(next);
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-16">
      <p className="text-[11px] font-semibold tracking-wide text-accent">DSA</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Administration du livre</h1>
      <p className="mt-2 max-w-[52ch] text-ink-soft">
        Éditeur du graphe de questions et revue des pages importées du livre. Réservé aux comptes administrateurs.
      </p>

      <div className="panel mt-6 rounded-md p-5">
        {SUPABASE_CONFIGURED ? (
          <SignInForm next={next} />
        ) : (
          <div className="space-y-2">
            <p className="font-medium">Le projet Supabase n’est pas configuré.</p>
            <p className="text-ink-soft">
              Copiez <code className="rounded-xs bg-surface-sunk px-1">.env.example</code> vers{' '}
              <code className="rounded-xs bg-surface-sunk px-1">.env.local</code>, renseignez{' '}
              <code className="rounded-xs bg-surface-sunk px-1">NEXT_PUBLIC_SUPABASE_URL</code> et{' '}
              <code className="rounded-xs bg-surface-sunk px-1">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>, puis relancez le serveur.
            </p>
          </div>
        )}
      </div>

      <p className="mt-4 text-ink-faint">
        Pas encore administrateur ? Créez le compte dans le tableau de bord Supabase, puis lancez{' '}
        <Link className="underline underline-offset-2" href="https://supabase.com/dashboard">
          02_make_admin.sql
        </Link>
        .
      </p>
    </main>
  );
}
