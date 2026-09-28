/**
 * The call's credentials come from the `livekit-token` Edge Function, with the
 * player's own JWT: it checks that the caller is one of the two players, that the
 * room is played with Voix, that the game is running and that the call has time
 * left. The LiveKit key and secret stay in Supabase (GRAPH_SPECIFICATION §8).
 */
import { ensureSignedIn, getSupabase } from '@/services/supabase';
import { CallError, type CallToken } from './types';

interface TokenResponse {
  url?: unknown;
  token?: unknown;
  ends_at?: unknown;
  error?: unknown;
  message_fr?: unknown;
}

/** The French line the function sent, when it sent one. */
function detailOf(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const message = (value as { message_fr?: unknown }).message_fr;
  return typeof message === 'string' && message !== '' ? message : null;
}

export async function fetchCallToken(sessionId: string): Promise<CallToken> {
  await ensureSignedIn();
  const { data, error } = await getSupabase().functions.invoke<TokenResponse>('livekit-token', {
    body: { session_id: sessionId },
  });

  if (error) {
    // supabase-js puts the function's own body on the error for a non-2xx status.
    const body = await readErrorBody(error);
    throw new CallError('TOKEN_REFUSED', detailOf(body) ?? null);
  }
  if (!data || typeof data.url !== 'string' || typeof data.token !== 'string' || typeof data.ends_at !== 'string') {
    throw new CallError('TOKEN_REFUSED', detailOf(data));
  }
  return { url: data.url, token: data.token, endsAt: data.ends_at };
}

/** `FunctionsHttpError` carries the response; anything else carries nothing useful. */
async function readErrorBody(error: unknown): Promise<unknown> {
  const response = (error as { context?: { json?: () => Promise<unknown> } }).context;
  if (!response || typeof response.json !== 'function') return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}
