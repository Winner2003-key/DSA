/**
 * Fallback for platforms without a call implementation. Metro resolves
 * `@/call/call` to `call.native.ts` on Android/iOS and to `call.web.ts` on the
 * web, so this file is only what TypeScript reads: the three files export the
 * same `createCall`.
 */
import { unsupportedCall, type VoiceCall } from './types';

export function createCall(): VoiceCall {
  return unsupportedCall();
}
