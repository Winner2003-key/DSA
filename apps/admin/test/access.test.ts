import { describe, expect, it, vi } from 'vitest';
import { gateOutcome, resolveAccess, type AccessClient } from '../src/lib/access';

function client(user: { id: string; email: string } | null, rpc: { data: unknown; error: { message: string } | null }) {
  const rpcSpy = vi.fn(async () => rpc);
  const stub: AccessClient = {
    auth: { getUser: async () => ({ data: { user } }) },
    rpc: rpcSpy,
  };
  return { stub, rpcSpy };
}

describe('admin gate', () => {
  it('sends a signed-out visitor to the sign-in page, keeping where they were going', async () => {
    const { stub, rpcSpy } = client(null, { data: false, error: null });
    const access = await resolveAccess(stub);
    expect(access).toEqual({ state: 'ANONYMOUS' });
    expect(rpcSpy).not.toHaveBeenCalled();
    expect(gateOutcome(access, '/graphes/livre')).toEqual({ redirectTo: '/connexion?suite=%2Fgraphes%2Flivre', render: 'FORBIDDEN' });
  });

  it('refuses a signed-in user who is not an admin', async () => {
    const { stub, rpcSpy } = client({ id: 'u1', email: 'joueur@example.com' }, { data: false, error: null });
    const access = await resolveAccess(stub);
    expect(rpcSpy).toHaveBeenCalledWith('dsa_is_admin');
    expect(access).toEqual({ state: 'FORBIDDEN', email: 'joueur@example.com' });
    expect(gateOutcome(access)).toEqual({ redirectTo: null, render: 'FORBIDDEN' });
  });

  it('refuses when the admin check itself fails', async () => {
    const { stub } = client({ id: 'u1', email: 'x@example.com' }, { data: null, error: { message: 'permission denied' } });
    expect(gateOutcome(await resolveAccess(stub)).render).toBe('FORBIDDEN');
  });

  it('does not treat a truthy non-boolean as admin', async () => {
    const { stub } = client({ id: 'u1', email: 'x@example.com' }, { data: 'true', error: null });
    expect((await resolveAccess(stub)).state).toBe('FORBIDDEN');
  });

  it('lets an admin in', async () => {
    const { stub } = client({ id: 'u2', email: 'admin@example.com' }, { data: true, error: null });
    const access = await resolveAccess(stub);
    expect(access).toEqual({ state: 'ADMIN', userId: 'u2', email: 'admin@example.com' });
    expect(gateOutcome(access)).toEqual({ redirectTo: null, render: 'APP' });
  });
});
