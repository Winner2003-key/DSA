import { isEngineError } from '@dsa/core';

import { fr, type ErrorCode } from '@/i18n/fr';

/**
 * Every failure the UI can show. `code` is the stable DSA code (server codes come
 * from `DSA_<CODE>: message`, see DATABASE_SCHEMA.md §3); `message` is the French
 * line to render. The raw server text is kept in `detail` for the report/logs only.
 */
export class DsaError extends Error {
  readonly code: ErrorCode;
  readonly detail: string | null;

  constructor(code: ErrorCode, detail: string | null = null) {
    super(fr.errors[code]);
    this.name = 'DsaError';
    this.code = code;
    this.detail = detail;
  }
}

function isKnownCode(code: string): code is ErrorCode {
  return Object.prototype.hasOwnProperty.call(fr.errors, code);
}

/** `DSA_ROOM_FULL: ...` → DsaError('ROOM_FULL'). Anything else → a sensible fallback. */
export function toDsaError(error: unknown): DsaError {
  if (error instanceof DsaError) return error;
  // @dsa/core throws `EngineError` with a bare code ("INVALID_REWIND: …"). The
  // offline service runs on that engine, so its failures must read in French too.
  if (isEngineError(error) && isKnownCode(error.code)) return new DsaError(error.code, error.message);

  const raw =
    typeof error === 'string'
      ? error
      : error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
        ? error.message
        : '';

  const prefix = raw.split(':', 1)[0]?.trim() ?? '';
  if (prefix.startsWith('DSA_')) {
    const code = prefix.slice('DSA_'.length);
    if (isKnownCode(code)) return new DsaError(code, raw);
    return new DsaError('UNKNOWN', raw);
  }

  if (/permission denied/i.test(raw)) return new DsaError('PERMISSION_DENIED', raw);
  if (/JWT|not authenticated|Auth session missing/i.test(raw)) return new DsaError('NOT_AUTHENTICATED', raw);
  if (/fetch|network|Failed to fetch|timeout|ECONNREFUSED/i.test(raw)) return new DsaError('NETWORK', raw);

  return new DsaError('UNKNOWN', raw || null);
}

/** The French line for any thrown value. */
export function errorMessage(error: unknown): string {
  return toDsaError(error).message;
}
