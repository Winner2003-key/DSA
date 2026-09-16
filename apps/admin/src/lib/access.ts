/**
 * The admin gate. Signing in is not enough: the session's user must be in
 * `admin_users`, which the database answers through `dsa_is_admin()`. Every
 * write in this app goes through the same session, so RLS is the real
 * enforcement — this gate only decides what the admin sees.
 */
import { MOCK_MODE } from './env';

export type Access =
  | { state: 'MOCK' }
  | { state: 'ANONYMOUS' }
  | { state: 'FORBIDDEN'; email: string | null }
  | { state: 'ADMIN'; userId: string; email: string | null };

/** The slice of `SupabaseClient` the gate needs, so tests can pass a stub. */
export interface AccessClient {
  auth: {
    getUser(): Promise<{ data: { user: { id: string; email?: string | null } | null } }>;
  };
  /** PromiseLike, because PostgREST's builder is a thenable rather than a Promise. */
  rpc(fn: 'dsa_is_admin'): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export async function resolveAccess(client: AccessClient): Promise<Access> {
  if (MOCK_MODE) return { state: 'MOCK' };
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return { state: 'ANONYMOUS' };
  const email = user.email ?? null;
  const { data, error } = await client.rpc('dsa_is_admin');
  // A failed check is treated as "not an admin": never open the app on an error.
  if (error || data !== true) return { state: 'FORBIDDEN', email };
  return { state: 'ADMIN', userId: user.id, email };
}

export interface GateOutcome {
  /** Non-null when the visitor must be sent elsewhere before anything renders. */
  redirectTo: string | null;
  render: 'APP' | 'FORBIDDEN';
}

/**
 * Signed-out visitors go to the sign-in page; signed-in non-admins stay where
 * they are and read "Accès réservé aux administrateurs", because bouncing them
 * to a sign-in form they have already completed explains nothing.
 */
export function gateOutcome(access: Access, returnTo?: string): GateOutcome {
  if (access.state === 'ANONYMOUS') {
    const suite = returnTo && returnTo !== '/' ? `?suite=${encodeURIComponent(returnTo)}` : '';
    return { redirectTo: `/connexion${suite}`, render: 'FORBIDDEN' };
  }
  if (access.state === 'FORBIDDEN') return { redirectTo: null, render: 'FORBIDDEN' };
  return { redirectTo: null, render: 'APP' };
}
