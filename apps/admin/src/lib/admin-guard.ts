import 'server-only';

import { gateOutcome, resolveAccess } from './access';
import { MOCK_MODE } from './env';
import { getServerClient } from './supabase/server';

/**
 * Server actions are public HTTP endpoints, so each one re-checks the gate
 * instead of trusting that the page which rendered the button was protected.
 * RLS would refuse the write anyway; this gives a clear message first.
 */
export async function assertAdmin(): Promise<void> {
  if (MOCK_MODE) return;
  const access = await resolveAccess(await getServerClient());
  if (gateOutcome(access).render !== 'APP') throw new Error('Accès réservé aux administrateurs');
}
